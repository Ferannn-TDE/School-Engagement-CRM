import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Textarea } from '../common/Textarea';
import { Button } from '../common/Button';
import { useAppContext } from '../../context/AppContext';
import { ILLINOIS_COUNTIES } from '../../constants';
import type { School } from '../../types';
import toast from 'react-hot-toast';

const schoolSchema = z.object({
  name: z.string().min(1, 'School name is required'),
  district: z.string().optional(),
  county: z.string().min(1, 'County is required'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  zipCode: z.string().min(5, 'Valid zip code required'),
  schoolType: z.enum(['high_school', 'middle_school']),
  notes: z.string().optional(),
});

type SchoolFormData = z.infer<typeof schoolSchema>;

interface SchoolFormProps {
  school?: School;
  onClose: () => void;
}

export function SchoolForm({ school, onClose }: SchoolFormProps) {
  const { addSchool, updateSchool } = useAppContext();
  const isEditing = !!school;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SchoolFormData>({
    resolver: zodResolver(schoolSchema),
    defaultValues: school
      ? {
          name: school.name,
          district: school.district || '',
          county: school.county,
          address: school.address,
          city: school.city,
          state: school.state,
          zipCode: school.zipCode,
          schoolType: school.schoolType,
          notes: school.notes || '',
        }
      : {
          state: 'IL',
          schoolType: 'high_school',
        },
  });

  const onSubmit = (data: SchoolFormData) => {
    if (isEditing && school) {
      updateSchool({
        ...school,
        ...data,
        district: data.district || undefined,
        notes: data.notes || undefined,
      });
      toast.success('School updated successfully');
    } else {
      addSchool({
        ...data,
        district: data.district || undefined,
        notes: data.notes || undefined,
        isActive: true,
      });
      toast.success('School added successfully');
    }
    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input
        label="School Name"
        required
        error={errors.name?.message}
        {...register('name')}
      />
      <Input
        label="District"
        error={errors.district?.message}
        {...register('district')}
      />
      <div className="grid grid-cols-2 gap-4">
        <Select
          label="County"
          required
          options={ILLINOIS_COUNTIES.map((c) => ({ value: c, label: c }))}
          placeholder="Select county"
          error={errors.county?.message}
          {...register('county')}
        />
        <Select
          label="School Type"
          required
          options={[
            { value: 'high_school', label: 'High School' },
            { value: 'middle_school', label: 'Middle School' },
          ]}
          error={errors.schoolType?.message}
          {...register('schoolType')}
        />
      </div>
      <Input
        label="Address"
        required
        error={errors.address?.message}
        {...register('address')}
      />
      <div className="grid grid-cols-3 gap-4">
        <Input
          label="City"
          required
          error={errors.city?.message}
          {...register('city')}
        />
        <Input
          label="State"
          required
          error={errors.state?.message}
          {...register('state')}
        />
        <Input
          label="Zip Code"
          required
          error={errors.zipCode?.message}
          {...register('zipCode')}
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
          {isEditing ? 'Update School' : 'Add School'}
        </Button>
      </div>
    </form>
  );
}
