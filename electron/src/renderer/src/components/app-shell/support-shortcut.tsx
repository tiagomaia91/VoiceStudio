import { Link } from '@tanstack/react-router';
import { ArrowUpRightIcon, GemIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import './support-shortcut.css';
import { GithubStar } from './github-star';

// Maia Voice (uso interno): sem atalhos de plano Pro e estrelas do GitHub
// no cabeçalho. Defina VITE_MAIA_SHOW_UPSTREAM_LINKS=1 para reexibir.
const SHOW_UPSTREAM_LINKS = import.meta.env.VITE_MAIA_SHOW_UPSTREAM_LINKS === '1';

export function SupportShortcut() {
  const { t } = useTranslation();
  if (!SHOW_UPSTREAM_LINKS) return null;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              to="/pro"
              aria-label={t('supportPlans.get_pro')}
              className="support-shortcut app-no-drag flex h-8 items-center gap-1.5 px-2.5 focus-visible:outline-2 focus-visible:outline-ring"
            />
          }
        >
          <GemIcon aria-hidden="true" className="size-3.5" />
          <span className="hidden text-xs font-semibold sm:inline">
            {t('supportPlans.get_pro')}
          </span>
          <ArrowUpRightIcon aria-hidden="true" className="size-3" />
        </TooltipTrigger>
        <TooltipContent surface="theme" side="bottom">
          {t('supportPlans.get_pro')}
        </TooltipContent>
      </Tooltip>
      <GithubStar />
    </div>
  );
}
