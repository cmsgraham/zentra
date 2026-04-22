'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type MiniWindowMode = 'none' | 'pip' | 'popup';

interface MiniWindowState {
  isOpen: boolean;
  mode: MiniWindowMode;
  isPipSupported: boolean;
  isSecureContext: boolean;
}

interface MiniWindowActions {
  open: () => Promise<void>;
  close: () => void;
}

// Extend DocumentPictureInPicture type for TypeScript
interface DocumentPictureInPictureWindow extends Window {
  document: Document;
}

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<DocumentPictureInPictureWindow>;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

const PIP_WIDTH = 340;
const PIP_HEIGHT = 420;
const POPUP_WIDTH = 360;
const POPUP_HEIGHT = 480;

/**
 * useMiniWindow - Manages detached mini working window
 * 
 * Supports two modes:
 * 1. Document Picture-in-Picture (preferred, always-on-top behavior)
 * 2. Popup window fallback (no always-on-top guarantee)
 * 
 * The hook handles:
 * - Feature detection
 * - Window lifecycle management
 * - Copying stylesheets to the new window
 * - Cleanup on unmount
 */
export function useMiniWindow(
  renderContent: (container: HTMLElement, onClose: () => void) => void
): MiniWindowState & MiniWindowActions {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<MiniWindowMode>('none');
  
  const pipWindowRef = useRef<DocumentPictureInPictureWindow | null>(null);
  const popupWindowRef = useRef<Window | null>(null);

  // Feature detection
  const isPipSupported = typeof window !== 'undefined' 
    && 'documentPictureInPicture' in window;
  const isSecureContext = typeof window !== 'undefined' 
    && window.isSecureContext;

  // Copy stylesheets to new window
  const copyStyles = useCallback((targetDoc: Document) => {
    // Copy all stylesheets
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((style) => {
      if (style instanceof HTMLStyleElement) {
        const newStyle = targetDoc.createElement('style');
        newStyle.textContent = style.textContent;
        targetDoc.head.appendChild(newStyle);
      } else if (style instanceof HTMLLinkElement) {
        const newLink = targetDoc.createElement('link');
        newLink.rel = 'stylesheet';
        newLink.href = style.href;
        targetDoc.head.appendChild(newLink);
      }
    });

    // Copy theme attribute
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme) {
      targetDoc.documentElement.setAttribute('data-theme', theme);
    }
  }, []);

  // Open via Document Picture-in-Picture
  const openPip = useCallback(async () => {
    if (!isPipSupported || !isSecureContext) return false;

    try {
      const pipWindow = await window.documentPictureInPicture!.requestWindow({
        width: PIP_WIDTH,
        height: PIP_HEIGHT,
      });

      pipWindowRef.current = pipWindow;

      // Setup document
      copyStyles(pipWindow.document);
      
      // Create container
      const container = pipWindow.document.createElement('div');
      container.id = 'mini-working-root';
      pipWindow.document.body.appendChild(container);

      // Set background
      pipWindow.document.body.style.margin = '0';
      pipWindow.document.body.style.background = 'var(--wm-bg)';

      // Render content
      renderContent(container, () => {
        pipWindow.close();
      });

      // Handle close
      pipWindow.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
        setIsOpen(false);
        setMode('none');
      });

      setMode('pip');
      setIsOpen(true);
      return true;
    } catch (error) {
      console.warn('Document PiP failed:', error);
      return false;
    }
  }, [isPipSupported, isSecureContext, copyStyles, renderContent]);

  // Open via popup window
  const openPopup = useCallback(() => {
    // Calculate center position
    const left = window.screenX + (window.outerWidth - POPUP_WIDTH) / 2;
    const top = window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2;

    const popup = window.open(
      '/planner/working/mini',
      'inkflow-mini-working',
      `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`
    );

    if (popup) {
      popupWindowRef.current = popup;
      setMode('popup');
      setIsOpen(true);

      // Monitor popup close
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          popupWindowRef.current = null;
          setIsOpen(false);
          setMode('none');
        }
      }, 500);

      return true;
    }

    return false;
  }, []);

  // Main open function
  const open = useCallback(async () => {
    // Try PiP first if supported
    if (isPipSupported && isSecureContext) {
      const success = await openPip();
      if (success) return;
    }

    // Fallback to popup
    openPopup();
  }, [isPipSupported, isSecureContext, openPip, openPopup]);

  // Close function
  const close = useCallback(() => {
    if (pipWindowRef.current) {
      pipWindowRef.current.close();
      pipWindowRef.current = null;
    }
    if (popupWindowRef.current && !popupWindowRef.current.closed) {
      popupWindowRef.current.close();
      popupWindowRef.current = null;
    }
    setIsOpen(false);
    setMode('none');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pipWindowRef.current) {
        pipWindowRef.current.close();
      }
      // Don't auto-close popup on unmount - let user control it
    };
  }, []);

  return {
    isOpen,
    mode,
    isPipSupported,
    isSecureContext,
    open,
    close,
  };
}

/**
 * getMiniWindowStatus - Returns a human-readable description of mini window capability
 */
export function getMiniWindowStatus(): {
  canUsePip: boolean;
  canUsePopup: boolean;
  message: string;
} {
  if (typeof window === 'undefined') {
    return {
      canUsePip: false,
      canUsePopup: false,
      message: 'Server rendering',
    };
  }

  const isSecure = window.isSecureContext;
  const hasPip = 'documentPictureInPicture' in window;

  if (hasPip && isSecure) {
    return {
      canUsePip: true,
      canUsePopup: true,
      message: 'Picture-in-Picture available',
    };
  }

  if (!isSecure) {
    return {
      canUsePip: false,
      canUsePopup: true,
      message: 'HTTPS required for Picture-in-Picture. Using popup mode.',
    };
  }

  return {
    canUsePip: false,
    canUsePopup: true,
    message: 'Picture-in-Picture not supported in this browser. Using popup mode.',
  };
}
