import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit, MapPin, Users, Calendar, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { SchoolForm } from '../components/schools/SchoolForm';
import { useAppContext } from '../context/AppContext';
import { ContactRoleLabels } from '../types';
import { formatSchoolType } from '../utils/helpers';
import toast from 'react-hot-toast';

export function SchoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getSchoolById, getContactsBySchool, getActivitiesBySchool, getEventsBySchool, deleteSchool } = useAppContext();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const school = id ? getSchoolById(id) : undefined;
  const contacts = useMemo(() => (id ? getContactsBySchool(id) : []), [id, getContactsBySchool]);
  const activities = useMemo(() => (id ? getActivitiesBySchool(id) : []), [id, getActivitiesBySchool]);
  const events = useMemo(() => (id ? getEventsBySchool(id) : []), [id, getEventsBySchool]);

  if (!school) {
    return (
      <div>
        <Header title="School Not Found" />
        <div className="p-8 text-center">
          <p className="text-neutral-400">This school doesn't exist or has been deleted.</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate('/schools')}>
            Back to Schools
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header
        title={school.name}
        subtitle={school.district || formatSchoolType(school.schoolType)}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => navigate('/schools')}>
              <ArrowLeft size={16} />
              Back
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowEditModal(true)}>
              <Edit size={16} />
              Edit
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 size={16} />
              Delete
            </Button>
          </div>
        }
      />
      <div className="p-8 space-y-6">
        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <div className="flex items-center gap-2 text-neutral-500 mb-2">
              <MapPin size={16} />
              <span className="text-sm font-medium">Location</span>
            </div>
            <p className="text-sm text-neutral-700">{school.address}</p>
            <p className="text-sm text-neutral-700">
              {school.city}, {school.state} {school.zipCode}
            </p>
            <p className="text-sm text-neutral-500 mt-1">{school.county} County</p>
          </Card>
          <Card>
            <div className="flex items-center gap-2 text-neutral-500 mb-2">
              <Users size={16} />
              <span className="text-sm font-medium">Contacts</span>
            </div>
            <p className="text-2xl font-bold text-neutral-800">{contacts.length}</p>
            <p className="text-sm text-neutral-400">{contacts.filter((c) => c.isActive).length} active</p>
          </Card>
          <Card>
            <div className="flex items-center gap-2 text-neutral-500 mb-2">
              <Calendar size={16} />
              <span className="text-sm font-medium">Events</span>
            </div>
            <p className="text-2xl font-bold text-neutral-800">{events.length}</p>
            <p className="text-sm text-neutral-400">{activities.length} total activities</p>
          </Card>
        </div>

        {/* Contacts List */}
        <Card>
          <h3 className="text-sm font-semibold text-neutral-700 mb-4">Contact Roster</h3>
          {contacts.length > 0 ? (
            <div className="divide-y divide-neutral-50">
              {contacts.map((contact) => (
                <div key={contact.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-neutral-700">
                      {contact.firstName} {contact.lastName}
                    </p>
                    <p className="text-xs text-neutral-400">{contact.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>{ContactRoleLabels[contact.role]}</Badge>
                    <Badge variant={contact.isActive ? 'success' : 'error'}>
                      {contact.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-400 py-4 text-center">No contacts for this school.</p>
          )}
        </Card>

        {/* Activity Timeline */}
        <Card>
          <h3 className="text-sm font-semibold text-neutral-700 mb-4">Activity History</h3>
          {activities.length > 0 ? (
            <div className="space-y-3">
              {activities
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((activity) => (
                  <div key={activity.id} className="flex items-start gap-3 py-2 border-b border-neutral-50 last:border-0">
                    <div className="w-2 h-2 rounded-full bg-siue-red mt-2 shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm text-neutral-700">{activity.description}</p>
                      {activity.outcome && (
                        <p className="text-xs text-neutral-500 mt-0.5">{activity.outcome}</p>
                      )}
                      <p className="text-xs text-neutral-400 mt-1">
                        {format(new Date(activity.date), 'MMM d, yyyy')}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-400 py-4 text-center">No activities recorded yet.</p>
          )}
        </Card>

        {school.notes && (
          <Card>
            <h3 className="text-sm font-semibold text-neutral-700 mb-2">Notes</h3>
            <p className="text-sm text-neutral-600 whitespace-pre-wrap">{school.notes}</p>
          </Card>
        )}
      </div>

      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title="Edit School" size="lg">
        <SchoolForm school={school} onClose={() => setShowEditModal(false)} />
      </Modal>

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          deleteSchool(school.id);
          toast.success('School deleted');
          navigate('/schools');
        }}
        title="Delete School"
        message={`Are you sure you want to delete "${school.name}"? This action cannot be undone.`}
        confirmLabel="Delete School"
      />
    </div>
  );
}
