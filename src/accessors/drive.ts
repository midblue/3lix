import * as c from '../common/index'

import { drive_v3, google } from 'googleapis'
import getClient from './client'

let client
let drive: drive_v3.Drive

let allFiles: { id: string; name: string }[] | undefined

export async function files(): Promise<
  ResponseOrError<{ id: string; name: string }[]>
> {
  if (!allFiles) {
    return await reloadAllFiles()
  }
  return allFiles
}

async function initDrive() {
  if (!client) client = await getClient()
  if (!drive)
    drive = google.drive({
      version: 'v3',
      auth: client,
    })
}

export async function reloadAllFiles(): Promise<
  ResponseOrError<{ id: string; name: string }[]>
> {
  await initDrive()

  const data = await drive.files.list({
    fields: 'files(id, name)',
    q: "mimeType='application/vnd.google-apps.document'",
  })
  if (!data?.data?.files) {
    allFiles = undefined
    return { error: 'No data' }
  }
  allFiles = data.data.files as {
    id: string
    name: string
  }[]
  allFiles = data.data.files as {
    id: string
    name: string
  }[]
  return data.data.files as { id: string; name: string }[]
}
