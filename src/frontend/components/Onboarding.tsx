import { useT } from '../i18n'

export function Onboarding() {
  const t = useT()
  return (
    <div className="onboarding">
      <h1>{t('onboarding.title')}</h1>
      <p>{t('onboarding.notConfigured')}</p>
      <h3>{t('onboarding.stepsHeading')}</h3>
      <ol>
        <li>{t('onboarding.step1')}</li>
        <li>
          {t('onboarding.step2Prefix')}
          <em>{t('onboarding.step2Em')}</em>
        </li>
        <li>
          {t('onboarding.step3')} <code>.env</code>:
        </li>
      </ol>
      <pre>
{`BACKEND=linear
LINEAR_API_KEY=lin_api_xxx`}
      </pre>
      <p>
        {t('onboarding.restart')} <code>docker compose restart</code>
      </p>
      <p style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
        {t('onboarding.otherBackends')}
      </p>
    </div>
  )
}
