// plugins/slug-math-remark.js
import {visitParents} from 'unist-util-visit-parents'

export default function slugMathRemark() {
  const SKIP_INSIDE = new Set(['code','inlineCode','link','linkReference','definition','html'])

  return (tree) => {
    visitParents(tree, 'text', (node, ancestors) => {
      if (ancestors.some(a => SKIP_INSIDE.has(a.type))) return
      let t = node.value

      // bloque: $$< ... >$$  -> $$ ... $$
      t = t.replace(/\$\$<([\s\S]*?)>\$\$/g, (_, inner) => `$$${inner}$$`)

      // inline: $< ... >$ -> $ ... $
      t = t.replace(/\$<([\s\S]*?)>\$/g, (_, inner) => `$${inner}$`)

      node.value = t
    })
  }
}