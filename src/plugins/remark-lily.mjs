import { visit } from 'unist-util-visit';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  buildLocalLilypondSourceAttempts,
  getLilypondBinary,
  sanitizeLilypondSvgMarkup,
} from '../lib/lilypond-support.mjs';

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
        const tmpLy = path.join(lilyDir, `${hash}.ly`);
        let lastRenderError = null;

        try {
          // Check if lilypond is installed
          const lilypondBinary = getLilypondBinary();
          if (!lilypondBinary) {
            // LilyPond not found (e.g. Vercel environment)
            // If SVG is missing and we can't generate it, we leave the code block as is.
            return;
          }

          for (const candidateSource of buildLocalLilypondSourceAttempts(code)) {
            try {
              fs.writeFileSync(tmpLy, candidateSource);
              execFileSync(
                lilypondBinary,
                ['-dbackend=svg', '-o', path.join(lilyDir, hash), tmpLy],
                { stdio: 'ignore' },
              );
            } catch (error) {
              lastRenderError = error;
            }

            if (fs.existsSync(svgPath)) {
              svgExists = true;
              break;
            }
          }
        } catch (e) {
          lastRenderError = e;
        } finally {
          if (fs.existsSync(tmpLy)) fs.unlinkSync(tmpLy);
        }

        if (!svgExists && lastRenderError) {
          console.error(`[remark-lily] Failed to generate SVG for ${hash}:`, lastRenderError.message);
        }
      }

      let midiExists = fs.existsSync(path.join(lilyDir, `${hash}.midi`));
      if (!midiExists && fs.existsSync(path.join(lilyDir, `${hash}.mid`))) {
         fs.renameSync(path.join(lilyDir, `${hash}.mid`), path.join(lilyDir, `${hash}.midi`));
         midiExists = true;
      }

      // 3. If SVG exists, replace code block with inline HTML
      if (svgExists) {
        let svgContent = sanitizeLilypondSvgMarkup(fs.readFileSync(svgPath, 'utf8'));
        svgContent = svgContent.replace(/<\?xml.*?\?>/, '').replace(/<!DOCTYPE.*?>/, '').trim();
        
        const midiUrl = midiExists ? `/lily/${hash}.midi` : '';
        const midiAttr = midiUrl ? ` data-midi-url="${midiUrl}"` : '';
        
        parent.children[index] = { 
          type: 'html', 
          value: `<figure class="lilypond-block lily-score" data-lily-url="/lily/${hash}.svg"${midiAttr}>\n${svgContent}\n</figure>` 
        };
      }
    });
  };
}
