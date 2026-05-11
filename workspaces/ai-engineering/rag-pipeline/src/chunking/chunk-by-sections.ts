export interface SectionChunk {
  readonly content: string;
  readonly index: number;
  readonly sectionTitle?: string;
}

const SECTION_HEADING = /^##\s+(.+)$/;

export function chunkBySections(text: string): SectionChunk[] {
  const lines = text.split(/\r?\n/);
  const sections: { content: string[]; title?: string }[] = [];
  let current: { content: string[]; title?: string } = { content: [] };

  for (const line of lines) {
    const headingMatch = SECTION_HEADING.exec(line);

    if (headingMatch) {
      if (current.content.join('\n').trim() !== '' || current.title !== undefined) {
        sections.push(current);
      }

      const title = headingMatch[1]?.trim();
      current = { content: [], ...(title === undefined ? {} : { title }) };
      continue;
    }

    current.content.push(line);
  }

  if (current.content.join('\n').trim() !== '' || current.title !== undefined) {
    sections.push(current);
  }

  const chunks: SectionChunk[] = [];
  let index = 0;

  for (const section of sections) {
    const body = section.content.join('\n').trim();

    if (body === '' && section.title === undefined) {
      continue;
    }

    const titlePart = section.title === undefined ? '' : `## ${section.title}\n\n`;
    const content = `${titlePart}${body}`.trim();

    if (content === '') {
      continue;
    }

    chunks.push({
      content,
      index,
      ...(section.title === undefined ? {} : { sectionTitle: section.title }),
    });
    index += 1;
  }

  return chunks;
}
