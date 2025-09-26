import type { ExtractionResult, ExtractorOptions } from '../types/extraction';
import { ExtractionError } from '../../../mcp/errors';
import { createChildLogger, withTiming } from '../../../utils/logger';
import {
  HEADING_SELECTORS,
  ALL_NON_TEXTUAL_SELECTORS,
  NOISE_SELECTORS,
  PAGE_HEADER_SELECTORS,
  CONTENT_SELECTORS,
} from './selectors';

export async function extractWithSpa(
  html: string,
  options: ExtractorOptions
): Promise<ExtractionResult> {
  const logger = createChildLogger(options.correlationId || 'unknown');

  return withTiming(logger, 'spa_extraction', async () => {
    try {
      // Check if Playwright is available
      let playwright: any;
      try {
        // Use require for optional peer dependency to avoid TypeScript issues
        playwright = await import('playwright');
      } catch (error) {
        logger.error(
          {
            event: 'spa_playwright_unavailable',
            error: error instanceof Error ? error.message : 'Unknown error',
            url: options.url,
          },
          'Playwright not available for SPA extraction'
        );
        throw new ExtractionError(
          'Playwright is required for SPA content extraction. Install with: npm install playwright',
          options.url
        );
      }

      logger.debug(
        {
          event: 'spa_browser_launch',
          url: options.url,
          htmlLength: html.length,
        },
        'Launching browser for SPA content extraction'
      );

      // Launch browser with aggressive timeouts and performance optimizations
      const browser = await Promise.race([
        playwright.chromium.launch({
          headless: true,
          timeout: 10000, // 10 second browser launch timeout
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-background-networking',
          ],
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Browser launch timeout')), 12000)
        ),
      ]);

      const context = await Promise.race([
        browser.newContext({
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          viewport: { width: 1280, height: 720 },
          ignoreHTTPSErrors: true,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Context creation timeout')), 5000)
        ),
      ]);

      const page = await context.newPage();

      try {
        logger.debug(
          { event: 'spa_content_setting' },
          'Setting HTML content and waiting for JavaScript execution'
        );

        // Set the HTML content with aggressive timeout
        await Promise.race([
          page.setContent(html, {
            waitUntil: 'domcontentloaded',
            timeout: 3000,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('setContent timeout')), 5000)
          ),
        ]);

        // Wait for dynamic content with shorter timeout
        logger.debug({ event: 'spa_wait_content' }, 'Waiting for dynamic content to render');

        try {
          await Promise.race([
            page.waitForFunction(
              () => {
                const appElement =
                  document.querySelector('#app') ||
                  document.querySelector('#root') ||
                  document.querySelector('[data-reactroot]') ||
                  document.querySelector('main');

                if (!appElement) return false;

                const content = appElement.textContent?.trim() || '';
                return content.length > 50;
              },
              { timeout: 2000 }
            ),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('waitForFunction timeout')), 3000)
            ),
          ]);

          logger.debug({ event: 'spa_content_ready' }, 'Dynamic content detected');
        } catch (error) {
          logger.debug(
            {
              event: 'spa_wait_timeout',
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            'Dynamic content wait timed out, proceeding with current content'
          );
        }

        // Short wait for remaining operations
        await page.waitForTimeout(200);

        logger.debug({ event: 'spa_content_extraction' }, 'Extracting content from rendered page');

        // Extract content after JavaScript execution
        const extractedData = await page.evaluate(
          (selectors: {
            ALL_NON_TEXTUAL_SELECTORS: string;
            NOISE_SELECTORS: string;
            PAGE_HEADER_SELECTORS: string;
            CONTENT_SELECTORS: string;
            HEADING_SELECTORS: string;
          }) => {
            // Remove non-textual elements first (similar to other extractors)
            const nonTextualSelectors = selectors.ALL_NON_TEXTUAL_SELECTORS.split(',').map(
              (s: string) => s.trim()
            );

            // Remove multimedia and non-textual elements
            nonTextualSelectors.forEach((selector: string) => {
              document.querySelectorAll(selector).forEach(el => el.remove());
            });

            // Remove noise elements
            const noiseSelectors = selectors.NOISE_SELECTORS.split(',').map((s: string) =>
              s.trim()
            );

            noiseSelectors.forEach((selector: string) => {
              document.querySelectorAll(selector).forEach(el => el.remove());
            });

            // Remove page-level headers
            const pageHeaderSelectors = selectors.PAGE_HEADER_SELECTORS.split(',').map(
              (s: string) => s.trim()
            );
            pageHeaderSelectors.forEach((selector: string) => {
              document.querySelectorAll(selector).forEach(el => el.remove());
            });

            // Extract title
            const title = document.title || undefined;

            // Extract language
            const lang =
              document.documentElement.lang ||
              document.querySelector('html')?.getAttribute('lang') ||
              undefined;

            // Find content area (prioritize semantic elements)
            const contentSelectors = selectors.CONTENT_SELECTORS.split(',').map((s: string) =>
              s.trim()
            );

            // Add SPA-specific selectors
            const spaSpecificSelectors = ['#app', '#root', '[data-reactroot]', '.app'];
            const allContentSelectors = [...contentSelectors, ...spaSpecificSelectors];

            let contentElement: Element = document.body;
            for (const selector of allContentSelectors) {
              const element = document.querySelector(selector);
              if (element && element.textContent && element.textContent.trim().length > 0) {
                contentElement = element;
                break;
              }
            }

            // Extract text content
            const textContent = contentElement.textContent?.trim() || '';

            // Extract section paths from headings
            const sectionPaths: string[] = [];
            const headings = contentElement.querySelectorAll(selectors.HEADING_SELECTORS);

            headings.forEach(heading => {
              const text = heading.textContent?.trim();
              if (text && text.length > 0) {
                sectionPaths.push(text);
              }
            });

            // If no headings in content area, check entire document
            if (sectionPaths.length === 0) {
              document.querySelectorAll(selectors.HEADING_SELECTORS).forEach(heading => {
                const text = heading.textContent?.trim();
                if (text && text.length > 0) {
                  sectionPaths.push(text);
                }
              });
            }

            // Generate excerpt from first 300 characters
            const excerpt =
              textContent.length > 300
                ? textContent.substring(0, 300).trim() + '...'
                : textContent || undefined;

            return {
              title,
              textContent,
              excerpt,
              sectionPaths,
              lang,
              contentLength: textContent.length,
            };
          },
          {
            ALL_NON_TEXTUAL_SELECTORS,
            NOISE_SELECTORS,
            PAGE_HEADER_SELECTORS,
            CONTENT_SELECTORS,
            HEADING_SELECTORS,
          }
        );

        // Check content quality - if insufficient, try URL navigation
        const contentLength = extractedData.contentLength || 0;
        const minContentThreshold = 500; // Same threshold as readability

        if (contentLength < minContentThreshold) {
          logger.debug(
            {
              event: 'spa_insufficient_content',
              contentLength,
              threshold: minContentThreshold,
              method: 'setContent',
            },
            'Insufficient content from setContent, trying URL navigation'
          );

          // Try navigating to the actual URL as fallback
          try {
            await Promise.race([
              page.goto(options.url, {
                waitUntil: 'domcontentloaded',
                timeout: 8000,
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('goto timeout')), 10000)
              ),
            ]);

            // Wait briefly for any dynamic content
            await page.waitForTimeout(1000);

            // Re-extract content after navigation
            const urlExtractedData = await page.evaluate(
              (selectors: any) => {
                // Same extraction logic as before
                const nonTextualSelectors = selectors.ALL_NON_TEXTUAL_SELECTORS.split(',').map(
                  (s: string) => s.trim()
                );
                nonTextualSelectors.forEach((selector: string) => {
                  document.querySelectorAll(selector).forEach(el => el.remove());
                });

                const noiseSelectors = selectors.NOISE_SELECTORS.split(',').map((s: string) =>
                  s.trim()
                );
                noiseSelectors.forEach((selector: string) => {
                  document.querySelectorAll(selector).forEach(el => el.remove());
                });

                const pageHeaderSelectors = selectors.PAGE_HEADER_SELECTORS.split(',').map(
                  (s: string) => s.trim()
                );
                pageHeaderSelectors.forEach((selector: string) => {
                  document.querySelectorAll(selector).forEach(el => el.remove());
                });

                const title = document.title || undefined;
                const lang =
                  document.documentElement.lang ||
                  document.querySelector('html')?.getAttribute('lang') ||
                  undefined;

                const contentSelectors = selectors.CONTENT_SELECTORS.split(',').map((s: string) =>
                  s.trim()
                );
                const spaSpecificSelectors = ['#app', '#root', '[data-reactroot]', '.app'];
                const allContentSelectors = [...contentSelectors, ...spaSpecificSelectors];

                let contentElement: Element = document.body;
                for (const selector of allContentSelectors) {
                  const element = document.querySelector(selector);
                  if (element && element.textContent && element.textContent.trim().length > 0) {
                    contentElement = element;
                    break;
                  }
                }

                const textContent = contentElement.textContent?.trim() || '';
                const sectionPaths: string[] = [];
                const headings = contentElement.querySelectorAll(selectors.HEADING_SELECTORS);

                headings.forEach(heading => {
                  const text = heading.textContent?.trim();
                  if (text && text.length > 0) {
                    sectionPaths.push(text);
                  }
                });

                if (sectionPaths.length === 0) {
                  document.querySelectorAll(selectors.HEADING_SELECTORS).forEach(heading => {
                    const text = heading.textContent?.trim();
                    if (text && text.length > 0) {
                      sectionPaths.push(text);
                    }
                  });
                }

                const excerpt =
                  textContent.length > 300
                    ? textContent.substring(0, 300).trim() + '...'
                    : textContent || undefined;

                return {
                  title,
                  textContent,
                  excerpt,
                  sectionPaths,
                  lang,
                  contentLength: textContent.length,
                };
              },
              {
                ALL_NON_TEXTUAL_SELECTORS,
                NOISE_SELECTORS,
                PAGE_HEADER_SELECTORS,
                CONTENT_SELECTORS,
                HEADING_SELECTORS,
              }
            );

            // Check if URL navigation produced better content
            if (urlExtractedData.contentLength >= minContentThreshold) {
              logger.debug(
                {
                  event: 'spa_url_success',
                  contentLength: urlExtractedData.contentLength,
                  sectionCount: urlExtractedData.sectionPaths.length,
                  hasTitle: !!urlExtractedData.title,
                  language: urlExtractedData.lang,
                },
                'URL navigation produced sufficient content'
              );

              return {
                ...urlExtractedData,
                extractionMethod: 'browser' as const,
                note: 'Content extracted using browser navigation after initial setContent failed',
              };
            } else {
              logger.debug(
                {
                  event: 'spa_url_insufficient',
                  contentLength: urlExtractedData.contentLength,
                  threshold: minContentThreshold,
                },
                'URL navigation also produced insufficient content'
              );
            }
          } catch (urlError) {
            logger.debug(
              {
                event: 'spa_url_failed',
                error: urlError instanceof Error ? urlError.message : 'Unknown error',
              },
              'URL navigation failed'
            );
          }

          // Both setContent and URL navigation failed to produce quality content
          throw new Error(
            `SPA extraction produced insufficient content: ${contentLength} < ${minContentThreshold} characters`
          );
        }

        // Content is sufficient from initial setContent approach
        logger.debug(
          {
            event: 'spa_extraction_success',
            contentLength: extractedData.contentLength,
            sectionCount: extractedData.sectionPaths.length,
            hasTitle: !!extractedData.title,
            language: extractedData.lang,
            method: 'setContent',
          },
          'SPA content extraction completed successfully'
        );

        const result: ExtractionResult = {
          ...extractedData,
          extractionMethod: 'browser',
          excerpt: extractedData.excerpt,
          note: 'Content extracted using browser rendering for JavaScript-heavy page',
        };

        return result;
      } finally {
        // Always clean up browser resources with timeout
        logger.debug({ event: 'spa_browser_cleanup' }, 'Cleaning up browser resources');
        try {
          await Promise.race([
            (async () => {
              await context.close();
              await browser.close();
            })(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Browser cleanup timeout')), 5000)
            ),
          ]);
        } catch (cleanupError) {
          logger.warn(
            {
              event: 'spa_cleanup_timeout',
              error: cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error',
            },
            'Browser cleanup timed out - resources may not be fully released'
          );
          // Force close if possible
          try {
            browser.close();
          } catch {
            // Ignore final cleanup errors
          }
        }
      }
    } catch (error) {
      logger.error(
        {
          event: 'spa_extraction_error',
          error: error instanceof Error ? error.message : 'Unknown error',
          url: options.url,
        },
        'SPA extraction failed'
      );

      if (error instanceof ExtractionError) {
        throw error;
      }

      throw new ExtractionError(
        `SPA extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        options.url
      );
    }
  });
}
