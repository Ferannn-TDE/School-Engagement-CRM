import { useNavigate } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { EmptyState } from '../components/common/EmptyState';
import { Button } from '../components/common/Button';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="p-8">
      <EmptyState
        icon={<FileQuestion size={32} />}
        title="Page not found"
        description="The page you're looking for doesn't exist."
        action={
          <Button onClick={() => navigate('/')}>
            Go to Dashboard
          </Button>
        }
      />
    </div>
  );
}
