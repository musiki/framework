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
      const midiPath = path.join(lilyDir, `${hash}.midi`);
      const midPath = path.join(lilyDir, `${hash}.mid`);

      // 1. Check if SVG already exists (cache/committed)
      let svgExists = fs.existsSync(svgPath);
      let midiExists = fs.existsSync(midiPath);
      if (!midiExists && fs.existsSync(midPath)) {
        fs.renameSync(midPath, midiPath);
        midiExists = true;
      }

      // 2. If SVG or MIDI is missing, try to generate the full asset set locally.
      if (!svgExists || !midiExists) {
        const tmpLy = path.join(lilyDir, `${hash}.ly`);
        let lastRenderError = null;

        try {
          // Check if lilypond is installed
          const lilypondBinary = getLilypondBinary();
          if (!lilypondBinary) {
            // LilyPond not found (e.g. build/runtime without the binary installed)
            // If SVG is missing and we can't generate it, we leave the code block as is.
            return;
          }

          for (const candidateSource of buildLocalLilypondSourceAttempts(code)) {
            try {
              fs.writeFileSync(tmpLy, candidateSource, 'utf8');
              execFileSync(
                lilypondBinary,
                ['-dbackend=svg', '-o', path.join(lilyDir, hash), tmpLy],
                { stdio: 'ignore' },
              );
            } catch (error) {
              lastRenderError = error;
            }

            if (fs.existsSync(midPath) && !fs.existsSync(midiPath)) {
              fs.renameSync(midPath, midiPath);
            }

            svgExists = fs.existsSync(svgPath);
            midiExists = fs.existsSync(midiPath);
            if (svgExists && midiExists) {
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
