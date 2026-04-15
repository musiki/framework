import { visit } from 'unist-util-visit';

/**
 * Remark plugin to handle cover blocks marked with:
 * <!--cover--> ... <!--/cover-->
 * or
 * %%cover%% ... %%/cover%%
 */
export default function remarkCoverBlock() {
  return (tree) => {
    // We need to look for text nodes or html nodes that might contain our markers
    // Since these can span multiple blocks, it's easier to process the raw string 
    // if possible, but remark gives us a tree.
    
    // Strategy: 
    // 1. Join all nodes into a pseudo-text? No, that loses structure.
    // 2. Identify start and end markers and wrap everything in between.
    
    // Actually, for Obsidian-like %% markers, they often appear in text nodes.
    // HTML comments appear as 'html' nodes.
    
    const nodes = tree.children;
    let startIndex = -1;
    let endIndex = -1;
    let markerType = null; // 'comment' or 'percent'

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const content = node.value || node.children?.[0]?.value || '';

      if (startIndex === -1) {
        if (content.includes('<!--cover-->')) {
          startIndex = i;
          markerType = 'comment';
        } else if (content.includes('%%cover%%')) {
          startIndex = i;
          markerType = 'percent';
        }
      } else {
        if (markerType === 'comment' && content.includes('<!--/cover-->')) {
          endIndex = i;
          break;
        } else if (markerType === 'percent' && content.includes('%%/cover%%')) {
          endIndex = i;
          break;
        }
      }
    }

    if (startIndex !== -1 && endIndex !== -1) {
      // Extract the children that belong to the cover
      const coverChildren = nodes.slice(startIndex, endIndex + 1);
      
      // Remove markers from the first and last node of the cover
      const firstNode = coverChildren[0];
      const lastNode = coverChildren[coverChildren.length - 1];
      
      if (firstNode.type === 'html' || firstNode.type === 'text') {
        firstNode.value = firstNode.value.replace('<!--cover-->', '').replace('%%cover%%', '');
      }
      if (lastNode.type === 'html' || lastNode.type === 'text') {
        lastNode.value = lastNode.value.replace('<!--/cover-->', '').replace('%%/cover%%', '');
      }

      // Create a wrapper div
      const wrapper = {
        type: 'parent', // Generic parent
        data: {
          hName: 'div',
          hProperties: {
            className: ['musiki-cover-block']
          }
        },
        children: coverChildren
      };

      // Replace the range with the wrapper
      nodes.splice(startIndex, endIndex - startIndex + 1, wrapper);
    }
  };
}
