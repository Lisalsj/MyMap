import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

interface MarkdownNode {
  type: string
  url?: string
  children?: MarkdownNode[]
}

const parse = (markdown: string) =>
  fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })

/** URLs here have already undergone CommonMark entity and escape decoding. */
function photoId(url: string): string | undefined {
  const match =
    /^mymap-photo:([a-zA-Z0-9_-]+)$/.exec(url) ||
    /^mymap-media:\/\/photo\/([a-zA-Z0-9_-]+)\/(?:thumb|preview|original)$/.exec(url)
  return match?.[1]
}

function visitPhotoUrls(node: MarkdownNode, visit: (node: MarkdownNode, id: string) => void): void {
  if (
    (node.type === 'image' || node.type === 'definition' || node.type === 'link') &&
    typeof node.url === 'string'
  ) {
    const id = photoId(node.url)
    if (id) visit(node, id)
  }
  for (const child of node.children || []) visitPhotoUrls(child, visit)
}

export function markdownPhotoIds(markdown: string): string[] {
  const ids = new Set<string>()
  visitPhotoUrls(parse(markdown), (_node, id) => ids.add(id))
  return [...ids]
}

/** Use the same parsed URL nodes as retention/validation, including definitions. */
export function portableJournalMarkdown(
  markdown: string,
  title: string,
  assets: Map<string, string>
): string {
  const tree = parse(markdown)
  const embedded = new Set<string>()
  visitPhotoUrls(tree, (node, id) => {
    const local = assets.get(id)
    if (!local) throw new Error('导出缺少游记引用的原图')
    node.url = local
    embedded.add(id)
  })
  tree.children.unshift({ type: 'heading', depth: 1, children: [{ type: 'text', value: title }] })
  for (const [id, url] of assets) {
    if (!embedded.has(id))
      tree.children.push({ type: 'paragraph', children: [{ type: 'image', url, alt: '照片' }] })
  }
  return toMarkdown(tree, { extensions: [gfmToMarkdown()], bullet: '-' })
}
