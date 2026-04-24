import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Edit, MapPin, Users, Calendar, Trash2, School, ArrowLeft, Plus, BookOpen, TrendingUp, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { SchoolForm } from '../components/schools/SchoolForm';
import { ProgramForm } from '../components/programs/ProgramForm';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Breadcrumb } from '../components/common/Breadcrumb';
import type { BreadcrumbTag } from '../components/common/Breadcrumb';
import { useAppContext } from '../context/AppContext';
import { ContactRoleLabels, ProgramCategoryLabels, ProgramCategory } from '../types';
import type { Program } from '../types';
import { formatSchoolType } from '../utils/helpers';
import { computeEngagementScore } from '../utils/engagementScore';
import toast from 'react-hot-toast';

export function SchoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    getSchoolById, getContactsBySchool, getActivitiesBySchool, getEventsBySchool,
    deleteSchool, deleteActivity, verifySchool,
    addProgram, deleteProgram, getProgramsBySchool,
    loading,
  } = useAppContext();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activityToDelete, setActivityToDelete] = useState<string | null>(null);
  const [showAddProgramModal, setShowAddProgramModal] = useState(false);
  const [programToDelete, setProgramToDelete] = useState<Program | null>(null);

  const decodedId = id ? decodeURIComponent(id) : undefined;
  const school = decodedId ? getSchoolById(decodedId) : undefined;
  const contacts = useMemo(() => (decodedId ? getContactsBySchool(decodedId) : []), [decodedId, getContactsBySchool]);
  const activities = useMemo(() => (decodedId ? getActivitiesBySchool(decodedId) : []), [decodedId, getActivitiesBySchool]);
  const events = useMemo(() => (decodedId ? getEventsBySchool(decodedId) : []), [decodedId, getEventsBySchool]);
  const programs = useMemo(() => (decodedId ? getProgramsBySchool(decodedId) : []), [decodedId, getProgramsBySchool]);

  const programsByCategory = useMemo(() => {
    const map = new Map<ProgramCategory, Program[]>();
    for (const p of programs) {
      const existing = map.get(p.category) ?? [];
      existing.push(p);
      map.set(p.category, existing);
    }
    return map;
  }, [programs]);

  const engagementResult = useMemo(
    () => computeEngagementScore(contacts, activities, events, programs),
    [contacts, activities, events, programs]
  );

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!school) {
    return (
      <EmptyState
        icon={<School size={32} />}
        title="School not found"
        description="This school doesn't exist or may have been deleted."
        action={
          <Button variant="secondary" onClick={() => navigate('/schools')}>
            <ArrowLeft size={16} />
            Back to Schools
          </Button>
        }
      />
    );
  }

  const schoolTags: BreadcrumbTag[] = [
    { label: formatSchoolType(school.schoolType), variant: 'default', className: 'border border-neutral-200' },
    ...(school.priorityTier === 'high'
      ? [{ label: 'High Priority', variant: 'warning' as const, className: 'border border-amber-200' }]
      : school.priorityTier === 'low'
      ? [{ label: 'Low Priority', variant: 'default' as const, className: 'border border-neutral-200' }]
      : []),
    {
      label: school.isVerified ? 'Verified' : 'Unverified',
      variant: school.isVerified ? 'success' as const : 'warning' as const,
      className: school.isVerified ? 'border border-green-200' : 'border border-amber-200',
    },
  ];

  return (
    <div>
      <Breadcrumb
        crumbs={[{ label: 'Schools', href: '/schools' }, { label: school.name }]}
        tags={schoolTags}
      />
      <Header
        title={school.name}
        subtitle={school.district || school.county + ' County'}
        actions={
          <div className="flex gap-2">
            {!school.isVerified && (
              <Button size="sm" variant="secondary" onClick={() => verifySchool(school.id)}>
                <ShieldCheck size={16} />
                Verify
              </Button>
            )}
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
            {(school.enrollment != null || school.gradeRange) && (
              <div className="mt-2 pt-2 border-t border-neutral-50 flex gap-4">
                {school.enrollment != null && (
                  <div>
                    <p className="text-xs text-neutral-400">Enrollment</p>
                    <p className="text-sm font-medium text-neutral-700">
                      {school.enrollment.toLocaleString()}
                    </p>
                  </div>
                )}
                {school.gradeRange && (
                  <div>
                    <p className="text-xs text-neutral-400">Grades</p>
                    <p className="text-sm font-medium text-neutral-700">{school.gradeRange}</p>
                  </div>
                )}
              </div>
            )}
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

        {/* Engagement Overview */}
        <Card>
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2 rounded-lg bg-siue-red/10">
              <TrendingUp size={20} className="text-siue-red" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-800">Engagement Overview</h3>
              <p className="text-xs text-neutral-400">
                Computed from contacts, activities, events, and programs
              </p>
            </div>
          </div>
          <div className="flex gap-6">
            <div className="text-center shrink-0 w-20">
              <p className="text-3xl font-bold text-neutral-800">{engagementResult.score}</p>
              <p className="text-xs text-neutral-400 mb-2">/ 100</p>
              <Badge
                variant={
                  engagementResult.tier === 'high'
                    ? 'success'
                    : engagementResult.tier === 'medium'
                    ? 'warning'
                    : 'error'
                }
              >
                {engagementResult.tier === 'high'
                  ? 'High'
                  : engagementResult.tier === 'medium'
                  ? 'Medium'
                  : 'Low'}
              </Badge>
            </div>
            <div className="flex-1 border-l border-neutral-100 pl-6">
              <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                Recommendations
              </p>
              <ul className="space-y-2">
                {engagementResult.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-neutral-700">
                    <span className="text-neutral-300 mt-0.5 shrink-0">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>

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

        {/* Programs & Offerings */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-siue-red/10">
                <BookOpen size={20} className="text-siue-red" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-neutral-800">Programs & Offerings</h3>
                <p className="text-xs text-neutral-400">
                  {programs.length} program{programs.length !== 1 ? 's' : ''} recorded
                </p>
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setShowAddProgramModal(true)}>
              <Plus size={14} />
              Add Program
            </Button>
          </div>
          {programs.length > 0 ? (
            <div className="space-y-5">
              {Object.values(ProgramCategory).map((category) => {
                const categoryPrograms = programsByCategory.get(category) ?? [];
                if (categoryPrograms.length === 0) return null;
                return (
                  <div key={category}>
                    <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                      {ProgramCategoryLabels[category]}
                    </p>
                    <div className="divide-y divide-neutral-50">
                      {categoryPrograms.map((program) => (
                        <div
                          key={program.id}
                          className="flex items-start justify-between py-2.5"
                        >
                          <div>
                            <p className="text-sm font-medium text-neutral-700">{program.name}</p>
                            {program.description && (
                              <p className="text-xs text-neutral-400 mt-0.5">{program.description}</p>
                            )}
                          </div>
                          <button
                            onClick={() => setProgramToDelete(program)}
                            className="text-neutral-300 hover:text-error transition-colors shrink-0 ml-4 mt-0.5"
                            aria-label="Remove program"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-neutral-400 py-4 text-center">
              No programs recorded — click "Add Program" to track STEM and engineering offerings.
            </p>
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
                    <button
                      onClick={() => setActivityToDelete(activity.id)}
                      className="text-neutral-300 hover:text-error transition-colors shrink-0 mt-0.5"
                      aria-label="Delete activity"
                    >
                      <Trash2 size={14} />
                    </button>
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

      <Modal
        open={showAddProgramModal}
        onClose={() => setShowAddProgramModal(false)}
        title="Add Program"
        size="md"
      >
        <ProgramForm
          onSubmit={(data) => {
            addProgram({ ...data, schoolId: school.id });
            toast.success('Program added');
            setShowAddProgramModal(false);
          }}
          onCancel={() => setShowAddProgramModal(false)}
        />
      </Modal>

      <ConfirmDialog
        open={programToDelete !== null}
        onClose={() => setProgramToDelete(null)}
        onConfirm={() => {
          if (programToDelete) {
            deleteProgram(programToDelete.id);
            toast.success('Program removed');
          }
          setProgramToDelete(null);
        }}
        title="Remove Program"
        message={`Remove "${programToDelete?.name}" from this school's programs?`}
        confirmLabel="Remove"
        variant="destructive"
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          deleteSchool(school.id);
          toast.success('School deleted');
          navigate('/schools');
        }}
        title="Delete School"
        message={
          contacts.length > 0
            ? `This will permanently delete "${school.name}" and its ${contacts.length} associated contact${contacts.length !== 1 ? 's' : ''}. This action cannot be undone.`
            : `Are you sure you want to delete "${school.name}"? This action cannot be undone.`
        }
        confirmLabel="Delete School"
      />

      <ConfirmDialog
        open={activityToDelete !== null}
        onClose={() => setActivityToDelete(null)}
        onConfirm={() => {
          if (activityToDelete) {
            deleteActivity(activityToDelete);
            toast.success('Activity deleted');
          }
          setActivityToDelete(null);
        }}
        title="Delete Activity"
        message="Are you sure you want to delete this activity? This action cannot be undone."
        confirmLabel="Delete Activity"
      />
    </div>
  );
}
