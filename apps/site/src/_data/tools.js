// Drives the home page, /tools/, and the footer. `article` points at the
// instructions for the tool, one URL per language.
export default [
  {
    slug: "printor",
    name: "printor",
    status: "live",
    description: {
      en: "Turns video and stills into printed-and-scanned frames. Runs on your device.",
      ru: "Превращает видео и картинки в напечатанные и отсканированные кадры. Работает на вашем устройстве.",
    },
    url: "/printor/",
    article: {
      en: "/articles/printor/",
      ru: "/ru/articles/printor/",
    },
  },
  {
    slug: "glyph-art",
    name: "glyph art",
    status: "live",
    description: {
      en: "Turns an image or video into a grid of glyphs. The size of each glyph carries the tone of its cell.",
      ru: "Превращает картинку или видео в сетку знаков. Размер знака передаёт тон своей ячейки.",
    },
    url: "/glyph-art/",
    article: {
      en: "/articles/glyph-art/",
      ru: "/ru/articles/glyph-art/",
    },
  },
];
