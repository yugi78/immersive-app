import { NoToneMapping, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import type { SceneConfig } from '../config/types';

export const isMobile = () =>
  window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function createRenderer(container: HTMLElement, cfg: SceneConfig['renderer']) {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const maxDpr = isMobile() ? cfg.maxPixelRatioMobile : cfg.maxPixelRatioDesktop;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  // Le fond est fixé par le viewer, synchronisé avec la couleur de la brume.
  return { renderer, scene };
}
