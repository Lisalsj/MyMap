const https = require('node:https')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const { HttpsProxyAgent } = require('https-proxy-agent')

function credential(env = process.env, execute = execFileSync) {
  if (env.GH_TOKEN || env.GITHUB_TOKEN) return env.GH_TOKEN || env.GITHUB_TOKEN
  try {
    const result = execute('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
    })
    const line = result.split(/\r?\n/).find((item) => item.startsWith('password='))
    if (line?.slice(9)) return line.slice(9)
  } catch {}
  throw Error('GitHub 登录不可用，请先通过 Git 完成认证；也可通过 GH_TOKEN 环境变量提供凭据。')
}

function createClient({
  repository,
  token,
  env = process.env,
  log = console.log,
  requestImpl = https.request
}) {
  const proxy = env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy
  const agent = proxy ? new HttpsProxyAgent(proxy) : new https.Agent({ keepAlive: true })
  const apiRoot = `https://api.github.com/repos/${repository}`

  function request(method, url, { json, file, publicDownload = false, range, redirects = 0 } = {}) {
    const target = new URL(url)
    const privateHost = ['api.github.com', 'uploads.github.com'].includes(target.hostname)
    const publicHost = [
      'github.com',
      'release-assets.githubusercontent.com',
      'objects.githubusercontent.com'
    ].includes(target.hostname)
    if (
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      (publicDownload ? !publicHost : !privateHost) ||
      redirects > 8
    )
      return Promise.reject(Error('拒绝向非预期地址发送发布请求。'))
    const body = json === undefined ? undefined : Buffer.from(JSON.stringify(json))
    const size = file ? fs.statSync(file).size : body?.length
    const headers = {
      'User-Agent': 'MyMap-local-release',
      Accept: publicDownload ? 'application/octet-stream' : 'application/vnd.github+json',
      ...(publicDownload ? {} : { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10' }),
      ...(range ? { Range: range } : {}),
      ...(size === undefined ? {} : { 'Content-Length': size }),
      ...(file
        ? { 'Content-Type': 'application/octet-stream' }
        : body
          ? { 'Content-Type': 'application/json' }
          : {})
    }
    return new Promise((resolve, reject) => {
      let stream,
        transferred = 0,
        lastPercent = 0
      const req = requestImpl(target, { method, agent, headers }, (response) => {
        if (
          publicDownload &&
          [301, 302, 303, 307, 308].includes(response.statusCode) &&
          response.headers.location
        ) {
          response.resume()
          resolve(
            request('GET', new URL(response.headers.location, target).href, {
              publicDownload: true,
              range,
              redirects: redirects + 1
            })
          )
          return
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume()
          const error = Error(`GitHub 请求失败：HTTP ${response.statusCode}。`)
          error.status = response.statusCode
          reject(error)
          return
        }
        // A server may ignore Range. Keep only the prefix, without downloading the full installer.
        const limit = publicDownload ? (range ? 1024 : 65536) : 2 * 1024 * 1024
        const chunks = []
        let received = 0,
          finished = false
        response.on('data', (chunk) => {
          if (finished) return
          if (range && received + chunk.length >= limit) {
            chunks.push(chunk.subarray(0, limit - received))
            finished = true
            resolve(Buffer.concat(chunks))
            response.destroy()
            return
          }
          received += chunk.length
          if (received > limit) {
            finished = true
            req.destroy()
            reject(Error('GitHub 响应超过预期大小。'))
          } else chunks.push(chunk)
        })
        response.on('end', () => {
          if (finished) return
          const data = Buffer.concat(chunks)
          if (publicDownload) resolve(data)
          else {
            try {
              resolve(JSON.parse(data.toString('utf8')))
            } catch {
              reject(Error('GitHub 返回了无效的发布数据。'))
            }
          }
        })
        response.on('error', (error) => {
          if (!finished) reject(Error(`GitHub 响应中断：${error.code || 'NETWORK_ERROR'}。`))
        })
        response.on('aborted', () => {
          if (!finished) reject(Error('GitHub 响应中断，请检查网络后续传。'))
        })
      })
      req.setTimeout(60000, () => req.destroy(Object.assign(Error(), { code: 'ETIMEDOUT' })))
      req.on('error', (error) => {
        stream?.destroy()
        reject(
          Error(`GitHub 连接失败：${error.code || 'NETWORK_ERROR'}。检查网络或 HTTPS_PROXY 设置后重试。`)
        )
      })
      if (file) {
        stream = fs.createReadStream(file, { highWaterMark: 128 * 1024 })
        stream.on('data', (chunk) => {
          transferred += chunk.length
          const percent = Math.floor((transferred / size) * 10) * 10
          if (percent > lastPercent) {
            lastPercent = percent
            log(`上传 ${require('node:path').basename(file)}：${percent}%`)
          }
        })
        stream.on('error', () => req.destroy(Object.assign(Error(), { code: 'LOCAL_FILE_ERROR' })))
        stream.pipe(req)
      } else req.end(body)
    })
  }

  return {
    async preflight() {
      const repo = await request('GET', apiRoot)
      if (repo.private || !repo.permissions?.push || repo.default_branch !== 'main')
        throw Error('发布要求公开仓库、main 默认分支和当前账号的推送权限。')
    },
    async release(tag) {
      try {
        return await request('GET', `${apiRoot}/releases/tags/${encodeURIComponent(tag)}`)
      } catch (error) {
        if (error.status === 404) return null
        throw error
      }
    },
    async tagCommit(tag) {
      let reference
      try {
        reference = await request('GET', `${apiRoot}/git/ref/tags/${encodeURIComponent(tag)}`)
      } catch (error) {
        if (error.status === 404) return null
        throw error
      }
      let object = reference.object
      for (let depth = 0; depth < 8 && object.type === 'tag'; depth++) {
        const tagObject = await request('GET', `${apiRoot}/git/tags/${object.sha}`)
        object = tagObject.object
      }
      if (object.type !== 'commit') throw Error('无法解析远端发布标签。')
      return object.sha
    },
    create: (tag, sha, notes) =>
      request('POST', `${apiRoot}/releases`, {
        json: {
          tag_name: tag,
          target_commitish: sha,
          name: `MyMap ${tag}`,
          body: notes,
          draft: true,
          prerelease: false
        }
      }),
    upload: (id, artifact, root) =>
      request(
        'POST',
        `https://uploads.github.com/repos/${repository}/releases/${id}/assets?name=${encodeURIComponent(artifact.name)}`,
        { file: require('node:path').join(root, 'release', artifact.name) }
      ),
    publish: (id) =>
      request('PATCH', `${apiRoot}/releases/${id}`, { json: { draft: false, make_latest: 'true' } }),
    async verifyPublic(tag, artifacts, root) {
      for (const artifact of artifacts) {
        const partial = artifact.name.endsWith('.exe')
        const result = await request(
          'GET',
          `https://github.com/${repository}/releases/download/${tag}/${artifact.name}`,
          {
            publicDownload: true,
            range: partial ? 'bytes=0-1023' : undefined
          }
        )
        const file = require('node:path').join(root, 'release', artifact.name)
        let expected
        if (partial) {
          const fd = fs.openSync(file, 'r')
          try {
            expected = Buffer.alloc(1024)
            fs.readSync(fd, expected, 0, 1024, 0)
          } finally {
            fs.closeSync(fd)
          }
        } else expected = fs.readFileSync(file)
        if (!result.equals(expected)) throw Error(`公开下载与已验证文件不一致：${artifact.name}`)
        log(`公开下载已核对：${artifact.name}`)
      }
    },
    close: () => agent.destroy()
  }
}

module.exports = { credential, createClient }
