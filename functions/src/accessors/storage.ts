import * as c from '../common/index'

// eslint-disable-next-line
import type { docs_v1 as docsv1 } from 'googleapis'

import axios from 'axios'
import { Storage } from '@google-cloud/storage'
const storage = new Storage()
const bucketName = `3lix-images`

import sharp from 'sharp'
import { reloadAllFiles } from './drive'
import { getDoc } from './docs'

const sizes = [
  { suffix: `-large`, size: 1200 },
  { suffix: `-small`, size: 500 },
  { suffix: `-tiny`, size: 100 },
]

/** returns onject ids of files that ARE uploaded and are used in the document */
export async function clearUnusedFilesInDocument(
  documentId: string,
  inlineObjects: {
    [key: string]: docsv1.Schema$InlineObject
  },
): Promise<{
  [key: string]: { size: number; path: string }[]
}> {
  const objectIds = Object.keys(inlineObjects)

  const existingFilesForDocument = await storage
    .bucket(bucketName)
    .getFiles({
      prefix: `${documentId}`,
    })
    .then((data) => {
      const files = (data[0] || []).filter((d) => d)
      c.log(
        `Found ${files.length} existing files for document ${documentId}`,
      )
      return files
        .map((file) => file.name.split(`/`)[1])
        .filter((name) => name)
    })

  const excessFiles = existingFilesForDocument.filter(
    (file) => !objectIds.includes(file.split(`-`)[0]),
  )

  const knownToExist: {
    [key: string]: { size: number; path: string }[]
  } = {}
  for (let file of excessFiles) {
    existingFilesForDocument.splice(
      existingFilesForDocument.indexOf(file),
      1,
    )
    await storage
      .bucket(bucketName)
      .file(`${documentId}/${file}`)
      .delete()
      .then(() => {
        c.log(`Deleted unused file ${file}.`)
      })
      .catch((err) => {
        c.error(
          `Error deleting unused file ${file}: ${err}`,
        )
      })
  }

  for (let file of existingFilesForDocument) {
    const id = file.split(`-`)[0]
    const size = file.split(`-`)[1].split(`.`)[0]
    const extension = file.split(`-`)[1].split(`.`)[1]
    knownToExist[id] = knownToExist[id] || []
    knownToExist[id].push({
      size:
        sizes.find((s) => s.suffix === `-${size}`)?.size ||
        0,
      path: `https://storage.googleapis.com/${bucketName}/${documentId}/${id}-${size}.${extension}`,
    })
  }

  return knownToExist
}

export async function resizeAndUpload(
  documentId: string,
  objectId: string,
  imageUrl: string,
): Promise<{ size: number; path: string }[]> {
  c.log(`Resizing and uploading ${imageUrl}`)
  const rawFile = await axios.get(imageUrl, {
    responseType: `arraybuffer`,
  })
  const contentType = rawFile.headers[`content-type`]
  const extension =
    contentType === `image/gif` ? `gif` : `jpg`

  const exists = await fileExists(
    `${documentId}/${objectId}${
      sizes[sizes.length - 1].suffix
    }.${extension}`,
  )
  if (exists) {
    c.log(
      `${objectId} already exists, returning existing paths`,
    )
    return sizes.map((size) => ({
      size: size.size,
      path: `https://storage.googleapis.com/${bucketName}/${documentId}/${encodeURI(
        objectId,
      )}${size.suffix}.${extension}`,
    }))
  }

  const outputData: {
    size: number
    path: string
  }[] = []

  for (let size of sizes) {
    let buffer: Buffer | undefined
    let sharpManip: Promise<sharp.Sharp> | sharp.Sharp =
      sharp(rawFile.data, {
        animated: extension === `gif`,
      }).resize(size.size, size.size, {
        fit: `inside`,
        withoutEnlargement: true,
      })
    if (extension === `gif`) {
      sharpManip = await (
        await sharpManip
      ).gif({
        loop: 0,
      })
    } else {
      sharpManip = await sharpManip.jpeg({
        progressive: true,
        quality: 80,
        force: false,
      })
    }
    buffer = await sharpManip.toBuffer().catch((err) => {
      c.log(err)
      return undefined
    })

    if (!buffer) continue

    const fileName = `${documentId}/${objectId}${size.suffix}.${extension}`

    const publicPath = await uploadFile(
      fileName,
      buffer,
      contentType === `image/gif` ? contentType : undefined,
    )
    if (typeof publicPath !== `string`) {
      c.error(publicPath.error)
      continue
    }
    outputData.push({
      size: size.size,
      path: publicPath,
    })
  }

  return outputData
}

async function fileExists(path: string): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      const [exists] = await storage
        .bucket(bucketName)
        .file(path)
        .exists()
      resolve(exists)
    } catch (error) {
      resolve(false)
    }
  })
}

async function uploadFile(
  path: string,
  data: Buffer,
  contentType?: string,
): Promise<ResponseOrError<string>> {
  return new Promise(async (resolve) => {
    try {
      const file = await storage
        .bucket(bucketName)
        .file(path)

      const blobStream = file.createWriteStream({
        resumable: false,
        metadata: {
          contentType: contentType || `image/jpeg`,
        },
      })
      blobStream.on(`error`, (err) =>
        resolve({ error: err.message || err }),
      )
      blobStream.on(`finish`, () => {
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeURI(
          file.name,
        )}`
        c.log(
          `Resized image ${publicUrl} uploaded to ${bucketName}`,
        )
        resolve(publicUrl)
      })
      blobStream.end(data)
    } catch (error) {
      resolve({
        error: `Error, could not upload file: ${error}`,
      })
    }
  })
}

export async function deleteAllImagesForDocumentId(
  id: string,
) {
  const files = await storage
    .bucket(bucketName)
    .getFiles({
      prefix: `${id}`,
    })
    .then((data) => {
      const files = (data[0] || []).filter((d) => d)
      c.log(
        `Found ${files.length} files for deletion for document ${id}`,
      )
      return files
    })

  for (let file of files) {
    await storage
      .bucket(bucketName)
      .file(file.name)
      .delete()
      .then(() => {
        c.log(`Deleted file ${file.name}.`)
      })
      .catch((err) => {
        c.error(`Error deleting file ${file.name}: ${err}`)
      })
  }
}

export async function checkForUnusedImagesInAllFiles() {
  const allDocIds: string[] = Object.values(
    await reloadAllFiles(),
  ).map((f) => f.id)

  const allDocIdsAssociatedWithImages = new Set<string>(
    await storage
      .bucket(bucketName)
      .getFiles({})
      .then((data) => {
        const files = (data[0] || []).filter((d) => d)
        return files
          .map((file) => file.name.split(`/`)[0])
          .filter((id) => id)
      }),
  )

  for (let idAssociatedWithImage of allDocIdsAssociatedWithImages) {
    if (!allDocIds.includes(idAssociatedWithImage)) {
      c.log(
        `Found image(s) associated with document that no longer exists`,
      )
      deleteAllImagesForDocumentId(idAssociatedWithImage)
    }
  }

  for (let id of allDocIds) {
    const docData = await getDoc(id)
    if (`error` in docData) {
      c.error(
        `Error getting doc ${id}: ${docData.error}, removing all files associated with it`,
      )
      deleteAllImagesForDocumentId(id)
      continue
    }

    const inlineObjectIds = Object.keys(
      docData.inlineObjects || {},
    )

    const existingFiles = await storage
      .bucket(bucketName)
      .getFiles({
        prefix: `${id}`,
      })
      .then((data) => {
        const files = (data[0] || []).filter((d) => d)
        c.log(
          `Found ${files.length} files for document ${id}`,
        )
        return files
      })

    for (let file of existingFiles) {
      if (
        !inlineObjectIds.includes(
          file.name.split(`/`)[1].split(`-`)[0],
        )
      ) {
        await storage
          .bucket(bucketName)
          .file(file.name)
          .delete()
          .then(() => {
            c.log(`Deleted unused file ${file.name}.`)
          })
          .catch((err) => {
            c.error(
              `Error deleting file ${file.name}: ${err}`,
            )
          })
      }
    }
  }
}
