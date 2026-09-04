'use client';
import Link from 'next/link';

import { useEffect, useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Menu, Sparkles } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/theme-provider';
import { flowEase, workspaceViews, type AppView } from '@/components/motion-system';

export function ProductNavigation({ view, ready, section, onNavigate }: { view: AppView; ready: boolean; section: string; onNavigate: (target: string) => void }) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const links = view === 'landing'
    ? [{ id: 'product', label: 'Product' }, { id: 'how-it-works', label: 'How it works' }, { id: 'demo-cases', label: 'Demo cases' }, { id: 'investigation', label: 'Investigation' }]
    : workspaceViews;
  const active = view === 'landing' ? section : view;

  useEffect(() => {
    const media = matchMedia('(min-width: 901px)');
    const closeOnDesktop = () => { if (media.matches) setOpen(false); };
    media.addEventListener('change', closeOnDesktop);
    return () => media.removeEventListener('change', closeOnDesktop);
  }, []);

  const select = (event: React.MouseEvent, target: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setOpen(false);
    onNavigate(target);
  };

  return <header className="site-header">
    <motion.a href="#top" onClick={(event) => select(event, 'top')} className="brand" aria-label="Settlement Trace AI home" initial={{ opacity: 0, x: reduced ? 0 : -20 }} animate={ready ? { opacity: 1, x: 0 } : { opacity: 0 }} transition={{ duration: 0.4, ease: flowEase }}><span className="brand-mark"><Sparkles size={18} /></span><span>Settlement Trace <b>AI</b></span></motion.a>
    <LayoutGroup id="desktop-navigation"><nav className="desktop-navigation" aria-label="Primary navigation">
      {links.map(({ id, label }, index) => <motion.a key={id} href={`#${id}`} onClick={(event) => select(event, id)} aria-current={active === id ? 'page' : undefined} initial={{ opacity: 0, y: reduced ? 0 : -8 }} animate={ready ? { opacity: 1, y: 0 } : { opacity: 0 }} transition={{ duration: 0.25, delay: reduced ? 0 : index * 0.045 }}>
        {active === id && <motion.i className="nav-indicator" layoutId="active" transition={{ duration: reduced ? 0.08 : 0.25, ease: flowEase }} />}
        <span>{label}</span>
      </motion.a>)}
    </nav></LayoutGroup>
    <motion.div className="header-tools" initial={{ opacity: 0, x: reduced ? 0 : 16 }} animate={ready ? { opacity: 1, x: 0 } : { opacity: 0 }} transition={{ duration: 0.4, delay: 0.1, ease: flowEase }}>
      <Link className="github-link" href="/workspace">Team workspace <ArrowUpRight size={13} /></Link><a className="github-link" href="https://github.com/Akshit-Singh-00/settlement-trace-ai" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13} /></a><ThemeToggle />
    </motion.div>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="mobile-menu-button" aria-label="Open navigation menu"><Menu size={19} /></SheetTrigger>
      <SheetContent className="mobile-drawer" side="right">
        <SheetTitle><span className="brand-mark"><Sparkles size={19} /></span>Settlement Trace AI</SheetTitle>
        <SheetDescription>Follow the evidence across every system.</SheetDescription>
        <nav aria-label="Mobile navigation">
          <Link href="/workspace">Team workspace <ArrowUpRight size={16} /></Link>
          {[{ id: 'top', label: 'Home' }, { id: 'product', label: 'Product' }, { id: 'how-it-works', label: 'How it works' }, ...workspaceViews].map(({ id, label }, index) => <a key={id} href={`#${id}`} onClick={(event) => select(event, id)} aria-current={active === id ? 'page' : undefined} style={{ '--link-delay': `${index * 25}ms` } as React.CSSProperties}><span>{label}</span><ArrowUpRight size={16} /></a>)}
        </nav>
        <p className="drawer-note">Simulated dataset — not live financial data.</p>
      </SheetContent>
    </Sheet>
  </header>;
}
