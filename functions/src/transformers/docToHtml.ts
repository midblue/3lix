import * as c from '../common/index'

import MarkdownIt from 'markdown-it'
const md = new MarkdownIt({
  html: true,
  breaks: true, // Convert '\n' in paragraphs into <br>
  linkify: true, // Autoconvert URL-like text to links
  typographer: true,
  quotes: `“”‘’`,
})

// eslint-disable-next-line
import type { docs_v1 as docsv1 } from 'googleapis'
import {
  clearUnusedFilesInDocument,
  resizeAndUpload,
} from '../accessors/storage'

export default async function docToHtml(
  data: docsv1.Schema$Document,
): Promise<ResponseOrError<string>> {
  const content = data.body?.content
  if (
    !content ||
    !Array.isArray(content) ||
    !data.documentId
  )
    return ``

  const inlineObjects: {
    [key: string]: docsv1.Schema$InlineObject
  } = data.inlineObjects || {}

  const knownToExist = await clearUnusedFilesInDocument(
    data.documentId,
    inlineObjects,
  )

  let html: string = ``

  content.forEach((contentElement) => {
    html += applyAdapters(contentElement)
  })

  html = await applyInlineObjects(
    data.documentId,
    html,
    inlineObjects,
    knownToExist,
  )

  html = finalize(html)
  c.log(html)

  return html
}

interface AdapterOptions {
  wrapParagraphs?: boolean
}

function applyAdapters(
  el: docsv1.Schema$StructuralElement,
  options: AdapterOptions = { wrapParagraphs: true },
): string {
  let html = ``
  for (let key of Object.keys(el)) {
    if (adapters[key]) {
      const output = adapters[key](el[key], options)
      if (output) html += output
    }
  }
  return html
}

const adapters: {
  [key: string]: (
    contentElement,
    options: AdapterOptions,
  ) => string | undefined
} = {
  paragraph: (
    contentElement: docsv1.Schema$Paragraph,
    options,
  ) => {
    let text = ``,
      images
    for (let paragraphElement of contentElement.elements ||
      []) {
      text += extractText(paragraphElement)
    }
    if (!text) return
    if ([`—`, `---`].includes(text)) return `<hr />` // replace lone em-dash with hr
    if (!options.wrapParagraphs || text.startsWith(`<`))
      return text
    return `<p>${text}</p>`
  },
  table: (contentElement: docsv1.Schema$Table, options) => {
    let text = ``,
      className = ``

    // extract class name if there's a full-width first row of a table
    if (
      contentElement.tableRows?.[0]?.tableCells?.[0]
        ?.content &&
      contentElement.tableRows?.[0]?.tableCells?.[0]
        ?.tableCellStyle?.columnSpan ===
        contentElement.tableRows?.[0]?.tableCells?.length
    )
      className = applyAdapters(
        contentElement.tableRows?.[0]?.tableCells?.[0]
          ?.content[0],
        {
          wrapParagraphs: false,
        },
      )

    // * data case, we return JSON.parse-able data
    if (className.includes(` data`)) {
      text += `<code data-id="${className.replace(
        ` data`,
        ``,
      )}">`

      const data: any[] = []
      const keys: string[] = []
      for (let tableRowIndex in contentElement.tableRows ||
        []) {
        // * first row is the header
        if (tableRowIndex === `0`) continue

        // * gather keys from second row
        if (tableRowIndex === `1`) {
          const tableRow = (contentElement.tableRows || [])[
            tableRowIndex
          ]
          for (let tableCell of tableRow.tableCells || []) {
            keys.push(
              applyAdapters((tableCell.content || [])[0], {
                wrapParagraphs: false,
              })
                .replace(/<[^>]*>/g, ``)
                .toLowerCase()
                .replace(/[^a-z0-9]/g, `-`),
            )
          }
          continue
        }

        // * gather data from other rows
        const tableRow = (contentElement.tableRows || [])[
          tableRowIndex
        ]
        const rowData = {}
        for (let tableCellIndex in tableRow.tableCells ||
          []) {
          let cellData = ``
          const tableCell = (tableRow.tableCells || [])[
            tableCellIndex
          ]
          for (let cellContent of tableCell.content || []) {
            cellData += applyAdapters(cellContent, {
              wrapParagraphs: false,
            }).replace(/"/g, `'`)
          }
          rowData[keys[tableCellIndex]] = cellData
        }
        data.push(rowData)
      }
      text += JSON.stringify(data)
      text += `</code>`
      return `${text}`
    }

    // * normal case, we parse out html elements

    text += `<div class="table ${className}">`
    for (let tableRowIndex in contentElement.tableRows ||
      []) {
      if (className && tableRowIndex === `0`) continue
      const tableRow = (contentElement.tableRows || [])[
        tableRowIndex
      ]
      text += `<div class="row">`
      for (let tableCell of tableRow.tableCells || []) {
        text += `<div class="cell">`
        for (let cellContent of tableCell.content || []) {
          text += applyAdapters(cellContent, {
            wrapParagraphs: false,
          })
        }
        text += `</div>`
      }
      text += `</div>`
    }
    text += `</div>`
    return `${text}`
  },
}

function extractText(element) {
  let text = element.textRun?.content
  if (!text && element.inlineObjectElement) {
    text = `INLINE_OBJECT(${element.inlineObjectElement.inlineObjectId})`
  } else {
    text = md
      .render((text || ``).trim())
      .trim()
      .replace(/^<p>/g, ``)
      .replace(/<\/p>$/g, ``)
  }

  // c.log(JSON.stringify(element, null, 2))

  const link = (
    element.textRun || element.inlineObjectElement
  )?.textStyle?.link
  if (link) return `<a href="${link.url}">${text}</a>`

  return text
}

async function applyInlineObjects(
  documentId: string,
  html: string,
  inlineObjects: {
    [key: string]: docsv1.Schema$InlineObject
  },
  knownToExist: {
    [key: string]: { size: number; path: string }[]
  },
) {
  const objectRegex = /INLINE_OBJECT\(([^)]+)\)/g
  let match
  while ((match = objectRegex.exec(html)) !== null) {
    let objectHtml = ``

    const objectId = match[1]
    let outputImages:
      | { size: number; path: string }[]
      | undefined = knownToExist[objectId]

    // new image, upload it
    if (!outputImages) {
      const object = inlineObjects[objectId]
      if (!object) continue
      const uri =
        object.inlineObjectProperties?.embeddedObject
          ?.imageProperties?.contentUri
      if (uri) {
        outputImages = await resizeAndUpload(
          documentId,
          objectId,
          uri,
        )
      }
    }

    if (outputImages) {
      c.log(outputImages)
      objectHtml = `<picture>`
      for (let outputImage of outputImages.slice(1))
        objectHtml += `<source srcset="${
          outputImage.path
        }" media="(max-width: ${
          outputImage.size * 0.8
        }px)" />`
      objectHtml += `<img src="${outputImages[0].path}" />`
      objectHtml += `</picture>`
    }
    html = html.replace(match[0], objectHtml)
  }
  return html
}

function finalize(rawHtml: string): string {
  return rawHtml
    .replace(/\n<\//g, `</`)
    .replace(/\n/g, `<br />`)
    .replace(/(?!:br ?\/?)>\s*<br ?\/?>/g, `>`)
}
