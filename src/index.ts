// share docs with id-lix@lix-338122.iam.gserviceaccount.com

const PORT = process.env.PORT || 3047
const BASE_URL = '/3lix'

import dotenv from 'dotenv'
dotenv.config()

import * as c from './common/index'
import { getHtml } from './accessors/docs'

import { files, reloadAllFiles } from './accessors/drive'
reloadAllFiles()

import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())

const router = express.Router()

router.get('/', (req, res) => {
  res.send('Hello World')
})

router.get('/debug6969/files', async (req, res) => {
  c.log('Getting all files')
  res.send(await files())
})

router.get(
  '/debug6969/reloadallfiles',
  async (req, res) => {
    c.log('Reloading all files')
    res.send(await reloadAllFiles())
  },
)

router.get('/doc/:id', async (req, res) => {
  const id = req.params.id

  const html = await getHtml(id)
  if (typeof html !== 'string') {
    res.status(500).send(html.error)
    return
  }
  res.send(html)
})

app.use(BASE_URL, router)

app.listen(PORT, () => {
  c.log('Express listening on port', PORT)
})
