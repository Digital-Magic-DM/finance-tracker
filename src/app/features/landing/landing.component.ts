import { Component, inject, signal, effect, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { Auth } from '@angular/fire/auth';
import { PwaService } from '../../services/pwa.service';

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
  private router = inject(Router);
  private el = inject(ElementRef);
  public pwaService = inject(PwaService);

  phrases = ['Wealth', 'Web', 'We'];
  currentPhrase = signal('');
  private phraseIndex = 0;
  private charIndex = 0;
  private isDeleting = false;

  constructor() {
    this.title.setTitle('DM FinTracker | High-Precision Financial Dashboard');
    this.meta.addTags([
      { name: 'description', content: 'DM FinTracker is a minimalist, high-precision financial dashboard for tracking expenses, investments, and net worth with unit-level accuracy.' },
      { name: 'keywords', content: 'DM FinTracker, finance dashboard, wealth forge, expense tracker, investment analytics, net worth tracking' },
      { property: 'og:title', content: 'DM FinTracker | Forged for Wealth' },
      { property: 'og:description', content: 'A high-precision financial dashboard for individuals who value mathematical clarity.' },
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

      this.initMomentumScroll();
    }
  }

  private targetScroll = 0;
  private currentScroll = 0;

  private initMomentumScroll() {
    const scrollContainer = this.el.nativeElement;
    this.targetScroll = scrollContainer.scrollTop;
    this.currentScroll = scrollContainer.scrollTop;
    const lerp = (start: number, end: number, amt: number) => (1 - amt) * start + amt * end;

    scrollContainer.addEventListener('wheel', (e: WheelEvent) => {
      // Only apply custom smooth scroll if not in a scrolling sub-grid
      const isOverGrid = (e.target as HTMLElement)?.closest('.solutions-grid');
      if (isOverGrid && window.innerWidth <= 768) return;

      e.preventDefault();
      this.targetScroll += e.deltaY;
      const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      this.targetScroll = Math.max(0, Math.min(this.targetScroll, maxScroll));
    }, { passive: false });

    const animate = () => {
      this.currentScroll = lerp(this.currentScroll, this.targetScroll, 0.1);
      scrollContainer.scrollTop = this.currentScroll;
      
      // If we are close to target, just snap to it
      if (Math.abs(this.targetScroll - this.currentScroll) < 1) {
        this.currentScroll = this.targetScroll;
        scrollContainer.scrollTop = this.targetScroll;
      }
      
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);

    // Sync target on manual scroll (e.g. scroll snap or key navigation)
    scrollContainer.addEventListener('scroll', () => {
      if (Math.abs(scrollContainer.scrollTop - this.currentScroll) > 10) {
        this.targetScroll = scrollContainer.scrollTop;
        this.currentScroll = scrollContainer.scrollTop;
      }

      // Active link tracking
      const sections = ['about', 'solutions'];
      let activeSectionId = '';
      sections.forEach(id => {
        const section = document.getElementById(id);
        if (section) {
          const rect = section.getBoundingClientRect();
          if (rect.top <= scrollContainer.clientHeight / 2) {
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

  scrollToSection(id: string) {
    const el = document.getElementById(id);
    if (el) {
      // Update targetScroll instead of using scrollIntoView
      // This allows the animation loop to take over smoothly
      this.targetScroll = el.offsetTop;
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
