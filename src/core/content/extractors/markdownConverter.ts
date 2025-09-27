import TurndownService from 'turndown';

/**
 * HTML to Markdown converter optimized for content chunking
 * Uses Turndown with semantic-aware configuration
 */
export class MarkdownConverter {
  private turndownService: TurndownService;

  constructor() {
    this.turndownService = new TurndownService({
      // Preserve semantic structure for chunking
      headingStyle: 'atx', // # ## ### style (better for chunking)
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced', // ```code``` (easier to detect)
      fence: '```',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
      linkReferenceStyle: 'full',
      preformattedCode: true,
    });

    this.configureRules();
  }

  private configureRules(): void {
    // Enhanced heading handling with hierarchy preservation
    this.turndownService.addRule('headings-with-hierarchy', {
      filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      replacement: (content: string, node: Node) => {
        const element = node as Element;
        const level = parseInt(element.tagName.charAt(1), 10);
        const hashes = '#'.repeat(level);
        return `\n\n${hashes} ${content.trim()}\n\n`;
      },
    });

    // Enhanced paragraph handling for better chunking boundaries
    this.turndownService.addRule('paragraphs-with-spacing', {
      filter: 'p',
      replacement: (content: string) => {
        return `\n\n${content.trim()}\n\n`;
      },
    });

    // Code blocks with language detection
    this.turndownService.addRule('code-blocks', {
      filter: 'pre',
      replacement: (content: string, node: Node) => {
        const element = node as Element;
        const code = element.textContent || '';
        const lang = this.detectLanguage(element);
        return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
      },
    });

    // Preserve list structure for semantic chunking
    this.turndownService.addRule('enhanced-lists', {
      filter: ['ul', 'ol'],
      replacement: (content: string) => {
        return `\n\n${content.trim()}\n\n`;
      },
    });

    // Enhanced blockquotes
    this.turndownService.addRule('blockquotes', {
      filter: 'blockquote',
      replacement: (content: string) => {
        return `\n\n> ${content.trim().replace(/\n/g, '\n> ')}\n\n`;
      },
    });

    // Tables for structured content
    this.turndownService.addRule('tables', {
      filter: 'table',
      replacement: (content: string) => {
        // Simple table conversion - could be enhanced
        return `\n\n<!-- Table content -->\n${content}\n\n`;
      },
    });

    // Remove elements that don't add semantic value
    this.turndownService.addRule('remove-noise', {
      filter: ['script', 'style', 'nav', 'aside', 'footer', 'header'],
      replacement: () => '',
    });
  }

  private detectLanguage(codeNode: Element): string {
    // Try to detect programming language from class names
    const className = codeNode.className || codeNode.querySelector('code')?.className || '';

    // Common patterns: language-js, lang-python, highlight-javascript, etc.
    const langMatch = className.match(/(?:language-|lang-|highlight-)([a-zA-Z0-9]+)/);
    if (langMatch) {
      return langMatch[1];
    }

    // Fallback detection based on content (very basic)
    const content = codeNode.textContent || '';
    if (content.includes('function ') || content.includes('=>')) return 'javascript';
    if (content.includes('def ') || content.includes('import ')) return 'python';
    if (content.includes('SELECT ') || content.includes('FROM ')) return 'sql';
    if (content.includes('<?php')) return 'php';

    return ''; // No language detected
  }

  /**
   * Convert cleaned HTML to semantic Markdown
   */
  convertToMarkdown(cleanedHtml: string): string {
    try {
      let markdown = this.turndownService.turndown(cleanedHtml);

      // Post-processing for better chunking
      markdown = this.postProcessMarkdown(markdown);

      return markdown.trim();
    } catch (error) {
      console.warn('Markdown conversion failed, falling back to text extraction:', error);
      // Fallback: strip HTML tags if Turndown fails
      return cleanedHtml
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  private postProcessMarkdown(markdown: string): string {
    return (
      markdown
        // Clean up excessive newlines (but preserve semantic spacing)
        .replace(/\n{4,}/g, '\n\n\n')
        // Ensure headings are properly spaced
        .replace(/([^\n])\n(#{1,6} )/g, '$1\n\n$2')
        // Ensure lists are properly spaced
        .replace(/([^\n])\n([*-] )/g, '$1\n\n$2')
        // Clean up list spacing
        .replace(/^([*-] .+)\n([*-] )/gm, '$1\n$2')
        // Final cleanup
        .trim()
    );
  }

  /**
   * Extract semantic structure for enhanced chunking
   */
  extractSemanticInfo(markdown: string): SemanticInfo {
    const headings: HeadingInfo[] = [];
    const codeBlocks: CodeBlockInfo[] = [];
    const lists: ListInfo[] = [];

    // Extract headings with hierarchy
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    let match;
    while ((match = headingRegex.exec(markdown)) !== null) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        position: match.index,
      });
    }

    // Extract code blocks
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    while ((match = codeBlockRegex.exec(markdown)) !== null) {
      codeBlocks.push({
        language: match[1] || 'text',
        content: match[2].trim(),
        position: match.index,
        length: match[0].length,
      });
    }

    // Extract lists
    const listRegex = /^([*-] .+(?:\n[*-] .+)*)/gm;
    while ((match = listRegex.exec(markdown)) !== null) {
      lists.push({
        content: match[1].trim(),
        position: match.index,
        itemCount: (match[1].match(/^[*-] /gm) || []).length,
      });
    }

    return {
      headings,
      codeBlocks,
      lists,
      wordCount: markdown.split(/\s+/).length,
      characterCount: markdown.length,
    };
  }
}

export interface HeadingInfo {
  level: number;
  text: string;
  position: number;
}

export interface CodeBlockInfo {
  language: string;
  content: string;
  position: number;
  length: number;
}

export interface ListInfo {
  content: string;
  position: number;
  itemCount: number;
}

export interface SemanticInfo {
  headings: HeadingInfo[];
  codeBlocks: CodeBlockInfo[];
  lists: ListInfo[];
  wordCount: number;
  characterCount: number;
}

// Singleton instance
export const markdownConverter = new MarkdownConverter();
