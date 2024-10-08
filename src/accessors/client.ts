import * as c from '../common/index'

import { google } from 'googleapis'
import type {
  JWT,
  Compute,
  UserRefreshClient,
  BaseExternalAccountClient,
  Impersonated,
} from 'google-auth-library'

let client: Compute

export default async function getClient() {
  if (client) return client

  const auth = new google.auth.GoogleAuth({
    keyFile: './credentials.json',
    scopes: [
      'https://www.googleapis.com/auth/documents.readonly',
      'https://www.googleapis.com/auth/drive',
    ],
  })

  // Create client instance for auth
  c.log('Creating client...')
  client = (await auth.getClient()) as unknown as Compute

  client.addListener('error', (err) => {
    c.error(err)
  })

  c.log('Client initialized.')
  return client
}
