import { Mail, Phone, School } from 'lucide-react';
import type { Contact } from '../../types';
import { Badge } from '../common/Badge';
import { contactRoleLabel } from '../../utils/contactRoles';
import { formatPhone } from '../../utils/helpers';

/** How to reach a contact: shown in a pop-up when a contact is clicked. */
export function ContactDetails({ contact, schoolName }: { contact: Contact; schoolName?: string }) {
  const name = `${contact.firstName} ${contact.lastName}`.trim() || 'Unnamed contact';
  return (
    <div className="space-y-4">
      <div>
        <p className="text-lg font-semibold text-neutral-800">{name}</p>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <Badge variant="info">{contactRoleLabel(contact)}</Badge>
          <Badge variant={contact.isActive ? 'success' : 'error'}>
            {contact.isActive ? 'Active' : 'Inactive'}
          </Badge>
        </div>
        {schoolName && (
          <p className="flex items-center gap-1.5 text-sm text-neutral-500 mt-2">
            <School size={14} className="shrink-0" />
            {schoolName}
          </p>
        )}
      </div>

      <dl className="space-y-3">
        <div className="flex items-start gap-3">
          <dt className="sr-only">Phone</dt>
          <Phone size={16} className="text-neutral-400 mt-0.5 shrink-0" aria-hidden="true" />
          <dd className="text-sm">
            {contact.phone ? (
              <a
                href={`tel:${contact.phone.replace(/ext\..*$/i, '').replace(/[^\d+]/g, '')}`}
                className="text-neutral-800 hover:text-siue-red"
              >
                {formatPhone(contact.phone)}
              </a>
            ) : (
              <span className="text-neutral-400">No phone on file</span>
            )}
          </dd>
        </div>
        <div className="flex items-start gap-3">
          <dt className="sr-only">Email</dt>
          <Mail size={16} className="text-neutral-400 mt-0.5 shrink-0" aria-hidden="true" />
          <dd className="text-sm break-all">
            {contact.email ? (
              <a href={`mailto:${contact.email}`} className="text-neutral-800 hover:text-siue-red">
                {contact.email}
              </a>
            ) : (
              <span className="text-neutral-400">No email on file</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
