import { Component, inject, signal, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';

import { PwaService } from '../../services/pwa.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss'
})
export class LandingComponent {
  private meta = inject(Meta);
  private title = inject(Title);

  private el = inject(ElementRef);
  public pwaService = inject(PwaService);
  public themeService = inject(ThemeService);

  phrases = ['Wealth', 'Web', 'We'];
  currentPhrase = signal('');
  private phraseIndex = 0;
  private charIndex = 0;
  private isDeleting = false;

    constructor() {
        const name = this.pwaService.appName();
        this.title.setTitle(`${name} | High-Precision Financial Dashboard`);
        this.meta.addTags([
            { name: 'description', content: `${name} is a minimalist, high-precision financial dashboard for tracking expenses, investments, and net worth with secure portfolio analytics and budget planning.` },
            { name: 'keywords', content: `${name}, personal finance tracker, expense tracker, net worth dashboard, portfolio management, budget planning, investment analytics` },
            { property: 'og:title', content: `${name} | Financial Dashboard & Portfolio Tracker` },
            { property: 'og:description', content: 'A high-precision financial dashboard for tracking spending, investments, and net worth with secure analytics.' },
            { property: 'og:type', content: 'website' }
        ]);

    // Start Typewriter
    this.type();

    // Smooth scroll handling for active state & animations
    if (typeof window !== 'undefined') {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const target = entry.target as HTMLElement;
            target.classList.add('visible');
            target.classList.remove('animate-trigger');

            if (target.classList.contains('solutions-section')) {
              target.querySelectorAll('.solution-card').forEach(card => {
                (card as HTMLElement).classList.add('visible');
                (card as HTMLElement).classList.remove('animate-trigger');
              });
            }
          }
        });
      }, { threshold: 0.1 });

      // Observe segments
      setTimeout(() => {
        const sections = ['about', 'solutions'];
        sections.forEach(id => {
          const sectionEl = document.getElementById(id);
          if (sectionEl) {
            sectionEl.classList.add('animate-trigger');
            sectionEl.querySelectorAll('.solution-card').forEach(card => card.classList.add('animate-trigger'));
            observer.observe(sectionEl);
          }
        });
      }, 500);

      this.initScrollTracking();
    }
  }

  private initScrollTracking() {
    const scrollContainer = this.el.nativeElement;
    
    scrollContainer.addEventListener('scroll', () => {
      // Active link tracking
      const sections = ['about', 'solutions'];
      let activeSectionId = '';
      sections.forEach(id => {
        const section = document.getElementById(id);
        if (section) {
          const rect = section.getBoundingClientRect();
          // Adjust threshold for active state
          if (rect.top <= scrollContainer.clientHeight / 2 && rect.bottom >= 0) {
            activeSectionId = id;
          }
        }
      });

      document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        const text = link.textContent?.toLowerCase() || '';
        if (activeSectionId && text.includes(activeSectionId)) {
          link.classList.add('active');
        }
      });
    }, { passive: true });
  }

  scrollToTop() {
    this.el.nativeElement.scrollTo({ top: 0, behavior: 'smooth' });
  }

  scrollToSection(id: string) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private type() {
    const fullPhrase = this.phrases[this.phraseIndex % this.phrases.length];

    if (this.isDeleting) {
      this.currentPhrase.set(fullPhrase.substring(0, this.charIndex - 1));
      this.charIndex--;
    } else {
      this.currentPhrase.set(fullPhrase.substring(0, this.charIndex + 1));
      this.charIndex++;
    }

    let typeSpeed = 150;

    if (this.isDeleting) {
      typeSpeed /= 2;
    }

    if (!this.isDeleting && this.charIndex === fullPhrase.length) {
      typeSpeed = 2000;
      this.isDeleting = true;
    } else if (this.isDeleting && this.charIndex === 0) {
      this.isDeleting = false;
      this.phraseIndex++;
      typeSpeed = 500;
    }

    setTimeout(() => this.type(), typeSpeed);
  }
}
