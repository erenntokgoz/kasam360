import React, { useRef } from 'react';
import { downloadFile } from '../../../lib/downloadFile';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';

interface AttachmentControlProps {
  ownerId: string;
  fileName: string | null;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onError: (caught: unknown) => void;
}

interface AttachmentFile {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });

export const AttachmentControl: React.FC<AttachmentControlProps> = ({ ownerId, fileName, canEdit, onChanged, onError }) => {
  const input = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    try {
      const contentBase64 = await readBase64(file);
      await invokeIPC('save_legal_attachment', {
        ...sessionArgs(), ownerId, fileName: file.name, mimeType: file.type || 'application/octet-stream', contentBase64,
      });
      await onChanged();
    } catch (caught) {
      onError(caught);
    }
  };

  const open = async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const file = await invokeIPC<AttachmentFile>('get_legal_attachment', { actorRole, tenantId, ownerId });
      const bytes = Uint8Array.from(atob(file.contentBase64), (char) => char.charCodeAt(0));
      downloadFile(file.fileName, bytes, file.mimeType);
    } catch (caught) {
      onError(caught);
    }
  };

  return (
    <>
      {fileName ? <Button variant="ghost" className="min-h-12 text-xs" onClick={() => void open()}>Dosya</Button> : null}
      {canEdit ? (
        <>
          <input
            ref={input}
            type="file"
            aria-label={`${ownerId} dosyası`}
            className="hidden"
            accept=".pdf,image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
          <Button variant="ghost" className="min-h-12 text-xs" onClick={() => input.current?.click()}>
            {fileName ? 'Değiştir' : 'Dosya Ekle'}
          </Button>
        </>
      ) : null}
    </>
  );
};
