import * as c from '../common/index'

// eslint-disable-next-line
import { docs_v1 as docsV1, google } from 'googleapis'
import getClient from './client'
import docToHtml from '../transformers/docToHtml'
// import { files } from './drive'

let client
let docs: docsV1.Docs
let cachedHtml: {
  id: string
  cacheTime: number
  data: string
}[] = []
const cacheExpirationTime = 1000 * 60 * 60 // 1 hour

async function initDocs() {
  if (!client) client = await getClient()
  if (!docs)
    docs = google.docs({
      version: `v1`,
      auth: client,
    })
}

export async function getDoc(
  id,
): Promise<ResponseOrError<docsV1.Schema$Document>> {
  if (id.indexOf(`.`) !== -1) return { error: `Invalid id` }
  // const existingFiles = await files()
  // if ('error' in existingFiles)
  //   return { error: existingFiles.error }
  // if (!existingFiles.find((f) => f.id === id))
  //   return {
  //     error: `File not found in file registry. <br /> <br />
  // Share the google doc with <b>id-lix@lix-338122.iam.gserviceaccount.com</b> if you haven't already!<br /> <br />
  // If you've already done that, click <a href="#" onclick="fetch('${c.baseUrl}/reloadallfiles')">here</a> to reload the server's list of files, and then refresh the page.`,
  //   }

  await initDocs()
  let data

  try {
    data = await docs.documents.get({
      documentId: id,
      fields: `title,body,revisionId,documentId,inlineObjects`,
    })
    c.log(`Fetching doc ${id} from google docs`)
  } catch (e) {
    c.error(e)
  }

  if (!data?.data)
    return {
      error: `No data found. Share the google doc with <b>id-lix@lix-338122.iam.gserviceaccount.com</b> if you haven't already!`,
    }

  return data.data
}

export async function getHtml(
  id,
  ignoreCache = false,
): Promise<ResponseOrError<string>> {
  const cached = cachedHtml.find((doc) => doc.id === id)
  if (cached) {
    if (
      !ignoreCache &&
      Date.now() - cacheExpirationTime < cached.cacheTime
    ) {
      c.log(`Using cached html`, id)
      return cached.data
    }
    cachedHtml.splice(cachedHtml.indexOf(cached), 1)
  }

  const doc = await getDoc(id)
  if (`error` in doc) return { error: doc.error }
  const html = await docToHtml(doc)

  if (typeof html === `string`)
    cachedHtml.push({
      id: id,
      cacheTime: Date.now(),
      data: html,
    })
  return html
}
