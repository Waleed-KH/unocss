import type { PreprocessorGroup } from 'svelte/types/compiler/preprocess'
import { type UnoGenerator, type UserConfig, type UserConfigDefaults, createGenerator, warnOnce } from '@unocss/core'
import presetUno from '@unocss/preset-uno'
import { loadConfig } from '@unocss/config'
import { transformClasses } from './transformClasses'
import { checkForApply, transformStyle } from './transformStyle'
import type { SvelteScopedContext, UnocssSveltePreprocessOptions } from './types'
import { themeRE } from './transformTheme'
import { wrapSelectorsWithGlobal } from './transformClasses/wrapGlobal'

export function UnocssSveltePreprocess(options: UnocssSveltePreprocessOptions = {}, unoContextFromVite?: SvelteScopedContext, isViteBuild?: () => boolean): PreprocessorGroup {
  if (!options.classPrefix)
    options.classPrefix = 'spu-'

  let uno: UnoGenerator

  return {
    markup: async ({ content, filename }) => {
      if (!uno)
        uno = await getGenerator(options.configOrPath, unoContextFromVite)

      if (isViteBuild && !options.combine)
        options.combine = isViteBuild()

      return await transformClasses({ content, filename: filename || '', uno, options })
    },

    style: async ({ content, attributes, filename }) => {
      let addPreflights = !!attributes['uno:preflights']
      let addSafelist = !!attributes['uno:safelist']

      if (unoContextFromVite && (addPreflights || addSafelist)) {
        // Svelte 4 style preprocessors will be able to remove attributes after handling them, but for now we must ignore them when using the Vite plugin to avoid a SvelteKit app double-processing that which a component library already processed.
        addPreflights = false
        addSafelist = false
        warnOnce('Notice for those transitioning to @unocss/svelte-scoped/vite: uno:preflights and uno:safelist are only for use in component libraries. Please see the documentation for how to add preflights and safelist into your head tag. If you are consuming a component library built by @unocss/svelte-scoped/preprocess, you can ignore this upgrade notice.') // remove notice in future
      }

      const { hasApply, applyVariables } = checkForApply(content, options.applyVariables)
      const hasThemeFn = !!content.match(themeRE)

      const changeNeeded = addPreflights || addSafelist || hasApply || hasThemeFn
      if (!changeNeeded)
        return

      if (!uno)
        uno = await getGenerator(options.configOrPath)

      let preflightsSafelistCss = ''
      if (addPreflights || addSafelist) {
        const { css } = await uno.generate([], { preflights: addPreflights, safelist: addSafelist, minify: true })
        preflightsSafelistCss = wrapSelectorsWithGlobal(css)
      }

      if (hasApply || hasThemeFn) {
        return await transformStyle({
          content,
          uno,
          filename,
          prepend: preflightsSafelistCss,
          applyVariables,
          hasThemeFn,
        })
      }

      if (preflightsSafelistCss)
        return { code: preflightsSafelistCss + content }
    },
  }
}

async function getGenerator(configOrPath?: UserConfig | string, unoContextFromVite?: SvelteScopedContext) {
  if (unoContextFromVite) {
    await unoContextFromVite.ready
    return unoContextFromVite.uno
  }

  const defaults: UserConfigDefaults = {
    presets: [
      presetUno(),
    ],
  }
  const { config } = await loadConfig(process.cwd(), configOrPath)
  return createGenerator(config, defaults)
}
