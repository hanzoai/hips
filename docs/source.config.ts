import {
  defineConfig,
  defineDocs,
} from "@hanzo/mdx/config"

export default defineConfig({
  mdxOptions: {
    rehypePlugins: [],
  },
})

export const docs = defineDocs({
  dir: "../HIPs",
})
