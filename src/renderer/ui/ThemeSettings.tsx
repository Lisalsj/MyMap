import { useState } from 'react'
import { Check } from './icons'
import { StickerIcon } from './StickerIcon'
import { setTheme, themes, useTheme } from './theme'

export function ThemeSettings() {
  const current = useTheme()
  const [saveFailed, setSaveFailed] = useState(false)
  return (
    <section className="settings-card theme-setting" aria-label="外观与主题">
      <div className="settings-section-heading">
        <StickerIcon kind="journal" />
        <div>
          <h2>外观与主题</h2>
          <p>为你的旅行图鉴，挑一种喜欢的颜色。</p>
        </div>
      </div>
      <div className="theme-options" role="radiogroup" aria-label="旅行图鉴主题">
        {themes.map((theme, index) => (
          <label className={`theme-option${current === theme.id ? ' is-selected' : ''}`} key={theme.id}>
            <input
              type="radio"
              name="theme"
              value={theme.id}
              aria-label={theme.name}
              checked={current === theme.id}
              onChange={() => setSaveFailed(!setTheme(theme.id))}
            />
            <span className="theme-preview" data-theme={theme.id} aria-hidden="true">
              <span className="theme-preview-sidebar">
                <i />
                <i />
                <i />
              </span>
              <span className="theme-preview-paper">
                <i />
                <span>
                  <StickerIcon kind={index ? 'memory' : 'map'} />
                </span>
              </span>
            </span>
            <span className="theme-option-copy">
              <strong>
                {theme.name}
                {current === theme.id && <Check size={17} aria-hidden="true" />}
              </strong>
              <span>{theme.description}</span>
            </span>
          </label>
        ))}
      </div>
      {saveFailed && (
        <p className="inline-error" role="status">
          主题已应用，本机偏好暂时无法保存；重启后可重新选择。
        </p>
      )}
    </section>
  )
}
