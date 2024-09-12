import * as c from '../common/index'

import { docs_v1, google } from 'googleapis'
import getClient from './client'
import docToHtml from '../transformers/docToHtml'
// import { files } from './drive'

let client
let docs: docs_v1.Docs
let cachedHtml: {
  id: string
  cacheTime: number
  revisionId: string | null
  data: string
}[] = []
const cacheExpirationTime = 1000 * 60 * 60 // 1 hour

async function initDocs() {
  if (!client) client = await getClient()
  if (!docs)
    docs = google.docs({
      version: 'v1',
      auth: client,
    })
}

export async function getDoc(
  id,
): Promise<ResponseOrError<docs_v1.Schema$Document>> {
  if (id.indexOf('.') !== -1) return { error: 'Invalid id' }
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
      fields:
        'title,body,revisionId,documentId,inlineObjects',
    })
    c.log(`Fetching doc ${id} from google docs`)
  } catch (e) {
    c.error(
      'error getting',
      id,
      (e as any).data?.error || (e as any).errors || e,
    )
  }

  if (!data?.data)
    return {
      error: `No data found. Share the google doc with <b>id-lix@lix-338122.iam.gserviceaccount.com</b> if you haven't already!`,
    }

  return data.data
}

export async function getHtml(id) {
  // * this is to use cached by time
  // const cached = cachedHtml.find((doc) => doc.id === id)
  // if (cached) {
  //   if (
  //     Date.now() - cacheExpirationTime <
  //     cached.cacheTime
  //   ) {
  //     c.log('Using cached html', id)
  //     return cached.data
  //   } else cachedHtml.splice(cachedHtml.indexOf(cached), 1)
  // }

  const doc = await getDoc(id)
  if ('error' in doc) return doc.error

  // * this is to use cached by revision id
  const matchesCachedRevisionId = cachedHtml.find(
    (d) => d.revisionId === doc.revisionId,
  )
  if (doc.revisionId && matchesCachedRevisionId) {
    c.log('Using cached html', id)
    return matchesCachedRevisionId.data
  }

  const html = await docToHtml(doc)
  // c.log(html)

  if (typeof html === 'string') {
    const existing = cachedHtml.find((d) => d.id === id)
    if (existing) {
      existing.cacheTime = Date.now()
      existing.revisionId = doc.revisionId || null
      existing.data = html
    } else
      cachedHtml.push({
        id: id,
        cacheTime: Date.now(),
        revisionId: doc.revisionId || null,
        data: html,
      })
  }
  return html
}
