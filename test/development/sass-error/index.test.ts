import { nextTestSetup } from 'e2e-utils'
import { waitForRedbox, getRedboxSource } from 'next-test-utils'

describe('app dir - css', () => {
  const { next, skipped } = nextTestSetup({
    files: __dirname,
    skipDeployment: true,
    dependencies: {
      sass: 'latest',
    },
  })

  if (skipped) {
    return
  }

  describe('sass support', () => {
    ;(process.env.IS_TURBOPACK_TEST ? describe : describe.skip)(
      'error handling',
      () => {
        it('should use original source points for sass errors', async () => {
          const browser = await next.browser('/sass-error')

          await waitForRedbox(browser)
          const source = await getRedboxSource(browser)

          // css-loader does not report an error for this case
          expect(source).toMatchInlineSnapshot(`
           "./app/global.scss.css (45:1)
           Parsing CSS source code failed
             43 | }
             44 |
           > 45 | input.defaultCheckbox::before path {
                | ^
             46 |   fill: currentColor;
             47 | }
             48 |

           Pseudo-elements like '::before' or '::after' can't be followed by selectors like 'Ident("path")'

           Generated code of PostCSS transform of loaders [next/dist/build/webpack/loaders/resolve-url-loader/index, next/dist/compiled/sass-loader] transform of file content of app/global.scss:
           ./app/global.scss.css:1:884
           > 1 | :root{--foreground-rgb: 0, 0, 0;--background-start-rgb: 214, 219, 220;--background-end-rgb: 255, 255, 255}@media(prefers-color-scheme: dark){:root{--foreground-rgb: 255, 255, 255;--background-start-rgb: 0, 0, 0;--background-end-rgb: 0, 0, 0}}body{font-family:monospace;color:#fff;background-color:#0e0f0f}@media(max-width: 1200px){body{font-size:16px}}@media(max-width: 992px){body{font-size:14px}}input.defaultCheckbox{color:#fff}input.defaultCheckbox::before{content:url("data:image/svg+xml,%3Csvg width='16' height='16' viewBox='0 0 16 16' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M6.66662 10.115L12.7946 3.98633L13.7379 4.92899L6.66662 12.0003L2.42395 7.75766L3.36662 6.81499L6.66662 10.115Z' fill='white'/%3E%3C/svg%3E%0A");fill:currentColor;opacity:0;height:16px;width:16px;top:-2px;position:absolute;left:50%;transform:translate(-50%, 0px)}input.defaultCheckbox::before path{fill:currentColor}input:checked.defaultCheckbox::before{opacity:1}.slide{animation:slide_anim .5s}@keyframes slide_anim{from{transform:translateX(50px);opacity:.4}to{transform:translateX(0);opacity:1}}.animation-opacity{animation:opacity_anim .5s}@keyframes opacity_anim{from{opacity:0}to{opacity:1}}
               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    ^

           Import trace:
             Client Component Browser:
               ./app/global.scss.css [Client Component Browser]
               ./app/layout.js [Client Component Browser]
               ./app/layout.js [Server Component]"
          `)
        })
      }
    )
  })
})
