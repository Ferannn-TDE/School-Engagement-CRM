import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Textarea } from '../common/Textarea';
import { Button } from '../common/Button';
import { useAppContext } from '../../context/AppContext';
import { ContactRole, ContactRoleLabels } from '../../types';
import type { Contact } from '../../types';
import toast from 'react-hot-toast';

const contactSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  role: z.nativeEnum(ContactRole),
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
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: contact
      ? {
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone || '',
          role: contact.role,
          schoolId: contact.schoolId,
          notes: contact.notes || '',
        }
      : {
          role: ContactRole.COUNSELOR,
        },
  });

  const onSubmit = (data: ContactFormData) => {
    if (isEditing && contact) {
      updateContact({
        ...contact,
        ...data,
        phone: data.phone || undefined,
        notes: data.notes || undefined,
      });
      toast.success('Contact updated successfully');
    } else {
      addContact({
        ...data,
        phone: data.phone || undefined,
        notes: data.notes || undefined,
        isActive: true,
      });
      toast.success('Contact added successfully');
    }
    onClose();
  };

  const roleOptions = Object.values(ContactRole).map((role) => ({
    value: role,
    label: ContactRoleLabels[role],
  }));

  const schoolOptions = state.schools
    .filter((s) => s.isActive)
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
          required
          error={errors.lastName?.message}
          {...register('lastName')}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Email"
          type="email"
          required
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
        <Select
          label="Role"
          required
          options={roleOptions}
          error={errors.role?.message}
          {...register('role')}
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
