import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      
      // Show prompt after a short delay
      setTimeout(() => {
        setShowPrompt(true);
      }, 2000);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    // Don't show again for this session
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  // Don't show if already dismissed in this session
  const wasDismissed = localStorage.getItem('pwa-install-dismissed');
  
  if (!showPrompt || !deferredPrompt || wasDismissed) {
    return null;
  }

  return (
    <div className="fixed left-4 right-4 bg-blue-600 text-white rounded-lg shadow-lg p-4 flex items-center gap-3 z-50 max-w-md mx-auto"
         style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <Download size={20} />
      <div className="flex-1">
        <p className="font-medium">Install TimePilot</p>
        <p className="text-sm opacity-90">Add to your home screen for quick access</p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleInstall}
          className="bg-white text-blue-600 px-3 py-1 rounded text-sm font-medium hover:bg-blue-50"
        >
          Install
        </button>
        <button
          onClick={handleDismiss}
          className="p-1 hover:bg-blue-700 rounded"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
