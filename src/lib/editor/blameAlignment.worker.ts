import { alignLineAttribution, type LineAttribution } from '../oneDriveBlame'

self.onmessage = (event: MessageEvent<{ before: string; after: string; attribution: LineAttribution[]; changed: LineAttribution }>) => {
  const { before, after, attribution, changed } = event.data
  self.postMessage(alignLineAttribution(before, after, attribution, changed))
}
