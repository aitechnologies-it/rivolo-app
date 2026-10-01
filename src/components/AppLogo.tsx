import type { Ref } from 'react'
import type { AppIdentity } from '../lib/appIdentity'

type AppLogoProps = {
  identity: AppIdentity
  size?: 'header' | 'hero'
  logoRef?: Ref<HTMLImageElement>
  animating?: boolean
}

export default function AppLogo({ identity, size = 'header', logoRef, animating = false }: AppLogoProps) {
  const isAit = identity === 'ait'
  const hero = size === 'hero'

  return (
    <span className={`app-brand relative inline-flex shrink-0 items-center ${hero ? 'gap-3' : 'gap-1.5'}`}>
      <img
        ref={logoRef}
        src="/logo.png"
        alt="Rivolo"
        className={`${hero
          ? 'hero-logo relative h-16 w-auto drop-shadow-[0_12px_30px_rgba(15,23,42,0.16)] sm:h-20'
          : `app-logo w-auto ${isAit ? 'h-8 sm:h-10' : 'h-10'}`
        } transition-opacity duration-300 ${animating ? 'opacity-0' : 'opacity-100'}`}
      />
      {isAit && (
        <span className={`ait-signature inline-flex items-center ${hero ? 'gap-3' : 'gap-1.5'} transition-opacity duration-300 ${animating ? 'opacity-0' : 'opacity-100'}`}>
          <span aria-hidden="true" className={`${hero ? 'text-lg' : 'text-xs'} text-[var(--theme-text-subtle)]`}>×</span>
          <img src="/ait-brain.svg" alt="AI Technologies" className={`ait-brain w-auto ${hero ? 'h-12 sm:h-14' : 'h-6 sm:h-7'}`} />
        </span>
      )}
    </span>
  )
}
