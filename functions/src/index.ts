import * as functions from 'firebase-functions'
import { getHtml } from './accessors/docs'
import { checkForUnusedImagesInAllFiles } from './accessors/storage'

export const doc = functions.https.onRequest(
  async (req, res): Promise<void> => {
    const id = req.params[`0`]
    if (!id) {
      res
        .status(400)
        .send(
          `Document id is required, add /{id} to the end of the url.`,
        )
      return
    }

    const html = await getHtml(id)
    if (typeof html !== `string`) {
      res.status(500).send(html.error)
      return
    }
    res.send(html)
  },
)

export const prune = functions.https.onRequest(
  async (req, res): Promise<void> => {
    await checkForUnusedImagesInAllFiles()
    res.send(`Done`)
  },
)

export const test = functions.https.onRequest(
  async (req, res): Promise<void> => {
    res.send(`test`)
  },
)
