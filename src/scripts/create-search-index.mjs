
import { glob } from 'glob';
import { readFileSync, writeFileSync } from 'fs';
import grayMatter from 'gray-matter';

async function createSearchIndex() {
  const contentPath = 'src/content';
  const publicPath = 'public';
  const files = await glob('**/*.md', { cwd: contentPath });

  const index = [];

  for (const file of files) {
    const filePath = `${contentPath}/${file}`;
    const fileContent = readFileSync(filePath, 'utf-8');
    const { data } = grayMatter(fileContent);

    if (data.title) { // Only index files with a title
      index.push({
        slug: `/${file.replace(/\.md$/, '')}`,
        title: data.title,
        description: data.description || '',
      });
    }
  }

  writeFileSync(`${publicPath}/search-index.json`, JSON.stringify(index, null, 2));
  console.log(`Search index created with ${index.length} entries.`);
}

createSearchIndex();
