import { useState } from 'react';
import { Pencil, ShieldOff, CheckCircle, UserX, UserCheck, Archive } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Contact } from '../../types';
import { useAppContext } from '../../context/useAppContext';
import { useConfirm } from '../../hooks/useConfirm';
import { Modal } from '../common/Modal';
import { ConfirmDialog } from '../common/ConfirmDialog';
import type { RowMenuItem } from '../common/RowActions';
import { ContactForm } from './ContactForm';

/**
 * A contact's Actions menu (Edit, Verify/Unverify, Deactivate/Activate, Archive) with
 * its confirms and dialogs, shared by the Contacts table and a school's Contact Roster
 * so both behave the same. Callers show the menu only to editors (useRole().canEdit).
 * Render `dialogs` once in the page.
 */
export function useContactActions() {
  const { updateContact, archiveContact, verifyContact, unverifyContact } = useAppContext();
  const [editing, setEditing] = useState<Contact | null>(null);
  const [archiving, setArchiving] = useState<Contact | null>(null);
  const { confirm, dialog } = useConfirm();

  const menuItems = (c: Contact): RowMenuItem[] => {
    const name = `${c.firstName} ${c.lastName}`.trim() || 'this contact';
    return [
      { icon: <Pencil size={14} />, label: 'Edit', onClick: () => setEditing(c) },
      // Verified is an on/off switch; turning it off asks first.
      c.isVerified
        ? {
          icon: <ShieldOff size={14} />,
          label: 'Unverify',
          onClick: () => confirm({
            title: `Unverify ${name}?`,
            message: `${name} goes back to the Unverified list. Nothing else changes. Your name and the time are recorded.`,
            confirmLabel: 'Unverify',
          }, () => unverifyContact(c.id)),
        }
        : { icon: <CheckCircle size={14} />, label: 'Verify', onClick: () => verifyContact(c.id) },
      c.isActive
        ? {
          icon: <UserX size={14} />,
          label: 'Deactivate',
          tone: 'danger',
          onClick: () => confirm({
            title: `Deactivate ${name}?`,
            message: `${name} stays on file but is left out of email lists and active counts. You can activate them again at any time.`,
            confirmLabel: 'Deactivate',
          }, () => {
            updateContact({ ...c, isActive: false });
            toast.success('Contact deactivated');
          }),
        }
        : {
          icon: <UserCheck size={14} />,
          label: 'Activate',
          onClick: () => {
            updateContact({ ...c, isActive: true });
            toast.success('Contact activated');
          },
        },
      { icon: <Archive size={14} />, label: 'Archive', tone: 'danger', onClick: () => setArchiving(c) },
    ];
  };

  const dialogs = (
    <>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Contact" size="lg">
        {editing && <ContactForm contact={editing} onClose={() => setEditing(null)} />}
      </Modal>
      <ConfirmDialog
        open={!!archiving}
        onClose={() => setArchiving(null)}
        onConfirm={() => {
          if (archiving) {
            archiveContact(archiving.id);
            toast.success('Contact archived');
          }
        }}
        title="Archive Contact"
        message={
          archiving
            ? `Archive "${`${archiving.firstName} ${archiving.lastName}`.trim()}"? They'll be hidden everywhere. You can restore them from Settings → Archived.`
            : ''
        }
        confirmLabel="Archive Contact"
      />
      {dialog}
    </>
  );

  return { menuItems, dialogs };
}
