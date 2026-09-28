import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Textarea } from '../common/Textarea';
import { Button } from '../common/Button';
import { useAppContext } from '../../context/AppContext';
import { ContactRoleLabels } from '../../types';
import type { Contact } from '../../types';
import { roleFromTitle } from '../../utils/contactRoles';
import toast from 'react-hot-toast';

const contactSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  // 1,833 scraped contacts have no email; requiring one made them impossible to edit.
  email: z.string().email('Invalid email address').or(z.literal('')),
  phone: z.string().optional(),
  title: z.string().optional(),
  schoolId: z.string().min(1, 'School is required'),
  notes: z.string().optional(),
});

type ContactFormData = z.infer<typeof contactSchema>;

interface ContactFormProps {
  contact?: Contact;
  onClose: () => void;
}

export function ContactForm({ contact, onClose }: ContactFormProps) {
  const { state, addContact, updateContact } = useAppContext();
  const isEditing = !!contact;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: contact
      ? {
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone || '',
          title: contact.title || '',
          schoolId: contact.schoolId,
          notes: contact.notes || '',
        }
      : { email: '', title: '' },
  });

  const category = roleFromTitle(watch('title'));

  const onSubmit = (data: ContactFormData) => {
    const edited: Partial<Contact> = {
      ...data,
      lastName: data.lastName || '',
      phone: data.phone || undefined,
      notes: data.notes || undefined,
      title: data.title?.trim() ?? '',
      role: roleFromTitle(data.title),
    };

    if (isEditing && contact) {
      // Save only what the user changed: the job title stays as typed (never a
      // category key), and the school link is only touched if the school changed.
      const changes: Partial<Contact> = {};
      for (const key of Object.keys(dirtyFields) as (keyof ContactFormData)[]) {
        (changes as Record<string, unknown>)[key] = edited[key as keyof Contact];
      }
      if (Object.keys(changes).length === 0) {
        toast('No changes to save');
        onClose();
        return;
      }
      if ('title' in changes) changes.role = edited.role;
      updateContact({ ...contact, ...changes }, changes);
      toast.success('Contact updated successfully');
    } else {
      addContact({
        ...(edited as Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>),
        isActive: true,
      });
      toast.success('Contact added successfully');
    }
    onClose();
  };

  // Active schools, plus the contact's own school even if it has been deactivated,
  // so editing never blanks the school.
  const schoolOptions = state.schools
    .filter((s) => s.isActive || s.id === contact?.schoolId)
    .map((s) => ({ value: s.id, label: s.name }));

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="First Name"
          required
          error={errors.firstName?.message}
          {...register('firstName')}
        />
        <Input
          label="Last Name"
          error={errors.lastName?.message}
          {...register('lastName')}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Email"
          type="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Phone"
          type="tel"
          error={errors.phone?.message}
          {...register('phone')}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Job title"
          placeholder="e.g. School Counselor"
          helpText={`Category: ${ContactRoleLabels[category]}`}
          error={errors.title?.message}
          {...register('title')}
        />
        <Select
          label="School"
          required
          options={schoolOptions}
          placeholder="Select school"
          error={errors.schoolId?.message}
          {...register('schoolId')}
        />
      </div>
      <Textarea
        label="Notes"
        rows={3}
        {...register('notes')}
      />
      <div className="flex justify-end gap-3 pt-4 border-t border-neutral-100">
        <Button variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {isEditing ? 'Update Contact' : 'Add Contact'}
        </Button>
      </div>
    </form>
  );
}
