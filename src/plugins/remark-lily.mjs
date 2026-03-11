import { visit } from 'unist-util-visit';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export default function remarkLily() {
  return (tree) => {
    // Ensure public/lily directory exists
    const lilyDir = path.join(process.cwd(), 'public', 'lily');
    if (!fs.existsSync(lilyDir)) {
      fs.mkdirSync(lilyDir, { recursive: true });
    }

    visit(tree, 'code', (node, index, parent) => {
      const lang = String(node.lang || '').trim().toLowerCase();
      if (lang !== 'lily' && lang !== 'lilypond' && lang !== 'ly') return;

      const code = node.value;
      // Create a hash of the code to use as filename
      const hash = crypto.createHash('md5').update(code).digest('hex');
      const svgFilename = `${hash}.svg`;
      const svgPath = path.join(lilyDir, svgFilename);
      const srcUrl = `/lily/${svgFilename}`;

      // 1. Check if SVG already exists (cache/committed)
      let svgExists = fs.existsSync(svgPath);

      // 2. If not, try to generate it (requires local lilypond)
      if (!svgExists) {
        try {
          // Check if lilypond is installed
          try {
            execSync('lilypond --version', { stdio: 'ignore' });
          } catch (e) {
            // LilyPond not found (e.g. Vercel environment)
            // If SVG is missing and we can't generate it, we leave the code block as is.
            return;
          }

          // Write temp .ly file
          const tmpLy = path.join(lilyDir, `${hash}.ly`);
          fs.writeFileSync(tmpLy, code);

          // Run LilyPond: -dbackend=svg -dno-point-and-click
          execSync(`lilypond -dbackend=svg -dno-point-and-click -o "${path.join(lilyDir, hash)}" "${tmpLy}"`, { stdio: 'ignore' });

          // Cleanup temp file
          if (fs.existsSync(tmpLy)) fs.unlinkSync(tmpLy);

          if (fs.existsSync(svgPath)) svgExists = true;
        } catch (e) {
          console.error(`[remark-lily] Failed to generate SVG for ${hash}:`, e.message);
        }
      }

      // 3. If SVG exists, replace code block with Image
      if (svgExists) {
        parent.children[index] = { type: 'html', value: `<div class="lily-score"><img src="${srcUrl}" alt="LilyPond Score" loading="lazy" /></div>` };
      }
    });
  };
}
