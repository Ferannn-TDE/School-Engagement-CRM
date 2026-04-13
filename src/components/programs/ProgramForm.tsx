import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Textarea } from '../common/Textarea';
import { Button } from '../common/Button';
import { ProgramCategoryLabels } from '../../types';
import type { Program } from '../../types';

const programSchema = z.object({
  name: z.string().min(1, 'Program name is required'),
  category: z.string().min(1, 'Category is required'),
  description: z.string().optional(),
});

type ProgramFormData = z.infer<typeof programSchema>;

type ProgramPayload = Omit<Program, 'id' | 'schoolId' | 'createdAt' | 'updatedAt'>;

interface ProgramFormProps {
  program?: Program;
  onSubmit: (data: ProgramPayload) => void;
  onCancel: () => void;
}

export function ProgramForm({ program, onSubmit, onCancel }: ProgramFormProps) {
  const isEditing = !!program;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProgramFormData>({
    resolver: zodResolver(programSchema),
    defaultValues: program
      ? {
          name: program.name,
          category: program.category,
          description: program.description ?? '',
        }
      : {},
  });

  const handleFormSubmit = (data: ProgramFormData) => {
    onSubmit({
      name: data.name,
      category: data.category as Program['category'],
      description: data.description || undefined,
      isActive: true,
    });
  };

  const categoryOptions = Object.entries(ProgramCategoryLabels).map(([value, label]) => ({
    value,
    label,
  }));

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      <Input
        label="Program Name"
        required
        placeholder="e.g. AP Computer Science"
        error={errors.name?.message}
        {...register('name')}
      />
      <Select
        label="Category"
        required
        options={categoryOptions}
        placeholder="Select a category"
        error={errors.category?.message}
        {...register('category')}
      />
      <Textarea
        label="Description"
        rows={3}
        placeholder="Optional — any relevant details about the program"
        {...register('description')}
      />
      <div className="flex justify-end gap-3 pt-4 border-t border-neutral-100">
        <Button variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {isEditing ? 'Update Program' : 'Add Program'}
        </Button>
      </div>
    </form>
  );
}
