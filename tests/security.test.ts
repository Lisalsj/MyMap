import { describe, expect, it } from 'vitest'
import { assetPath, isTrustedUrl, allowedRequest, mediaRequest } from '../src/main/security'
describe('local application boundaries', () => {
  it('only trusts the exact application origin or configured development origin', () => {
    expect(isTrustedUrl('mymap://app/index.html')).toBe(true)
    expect(isTrustedUrl('mymap://evil/index.html')).toBe(false)
    expect(isTrustedUrl('https://example.org/')).toBe(false)
    expect(isTrustedUrl('http://localhost:5173/editor', 'http://localhost:5173')).toBe(true)
    expect(isTrustedUrl('http://localhost:5174/editor', 'http://localhost:5173')).toBe(false)
  })
  it('blocks network schemes in the distributed application', () => {
    for (const url of [
      'https://example.org/image.jpg',
      'http://localhost:9000',
      'wss://example.org',
      'ftp://example.org'
    ])
      expect(allowedRequest(url)).toBe(false)
    expect(allowedRequest('mymap://app/assets/a.js')).toBe(true)
    expect(allowedRequest('mymap-media://photo/id/thumb')).toBe(true)
    expect(allowedRequest('data:image/png;base64,a')).toBe(true)
  })
  it('rejects encoded traversal, wrong host, and NUL asset paths', () => {
    expect(assetPath('D:\\app\\renderer', 'mymap://app/assets/index.js')).toMatch(/assets[\\/]index.js$/)
    expect(() => assetPath('D:\\app\\renderer', 'mymap://app/%2e%2e%2fsecret')).toThrow()
    expect(() => assetPath('D:\\app\\renderer', 'mymap://app/%00bad')).toThrow()
    expect(() => assetPath('D:\\app\\renderer', 'mymap://evil/index.html')).toThrow()
  })
  it('accepts only an ID and supported media variant, never an arbitrary file path', () => {
    expect(mediaRequest('mymap-media://photo/ab-12/preview')).toEqual({ id: 'ab-12', variant: 'preview' })
    for (const url of [
      'mymap-media://photo/../secret',
      'mymap-media://photo/a/unknown',
      'mymap-media://photo/a/original/extra',
      'mymap-media://evil/a/thumb',
      'mymap-media://photo/%2e%2e/original'
    ])
      expect(() => mediaRequest(url)).toThrow()
  })
})
