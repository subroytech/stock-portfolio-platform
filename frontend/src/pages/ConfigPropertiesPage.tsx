import { useState, type FormEvent } from 'react';
import {
  useConfigGroups, useCreateConfigGroup, useConfigProperties, useCreateConfigProperty,
  useUpdateConfigProperty, useSetConfigPropertyValue, useConfigPropertyValueHistory,
  type ConfigValueType, type ConfigProperty,
} from '../api/configProperties';
import { ApiError } from '../api/client';

const VALUE_TYPES: ConfigValueType[] = ['integer', 'string'];
const STATUSES = ['active', 'inactive'] as const;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

// Config Properties (Admin Console, 2026-08-24) - admin-master-only, general-purpose settings
// framework. Distinct from FunctionsPage (RBAC permission catalog) - see CLAUDE.md's Config
// Properties section. Groups and properties are created here; changing a property's *value*
// is a separate, versioned action (setPropertyValue) surfaced per-row below, since it's a
// different table/invariant than metadata edits.
export default function ConfigPropertiesPage() {
  const { data: groups, isLoading: groupsLoading } = useConfigGroups();
  const { data: properties, isLoading: propertiesLoading } = useConfigProperties();
  const createGroup = useCreateConfigGroup();
  const createProperty = useCreateConfigProperty();

  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');

  const [propGroupId, setPropGroupId] = useState('');
  const [propertyKey, setPropertyKey] = useState('');
  const [propName, setPropName] = useState('');
  const [propDescription, setPropDescription] = useState('');
  const [valueType, setValueType] = useState<ConfigValueType>('integer');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [initialValue, setInitialValue] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function handleCreateGroup(e: FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return;
    try {
      await createGroup.mutateAsync({ name: groupName.trim(), description: groupDescription.trim() || null });
      setGroupName('');
      setGroupDescription('');
    } catch {
      // surfaced via createGroup.isError below
    }
  }

  async function handleCreateProperty(e: FormEvent) {
    e.preventDefault();
    if (!propGroupId || !propertyKey.trim() || !propName.trim() || !initialValue.trim()) return;
    try {
      await createProperty.mutateAsync({
        groupId: propGroupId,
        propertyKey: propertyKey.trim(),
        name: propName.trim(),
        description: propDescription.trim() || null,
        valueType,
        minValue: valueType === 'integer' && minValue.trim() ? minValue.trim() : null,
        maxValue: valueType === 'integer' && maxValue.trim() ? maxValue.trim() : null,
        initialValue: initialValue.trim(),
      });
      setPropertyKey('');
      setPropName('');
      setPropDescription('');
      setMinValue('');
      setMaxValue('');
      setInitialValue('');
    } catch {
      // surfaced via createProperty.isError below
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleCreateGroup} className="flex flex-col gap-2 border-b border-border pb-4">
        <h3 className="text-sm font-semibold text-text-primary">New config group</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name (e.g. Data Retention Policies)"
            aria-label="Group name"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          />
          <input
            type="text"
            value={groupDescription}
            onChange={(e) => setGroupDescription(e.target.value)}
            placeholder="Description (optional)"
            aria-label="Group description"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          />
        </div>
        <button
          type="submit"
          disabled={createGroup.isPending || !groupName.trim()}
          className="ml-auto rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60"
        >
          Create group
        </button>
        {createGroup.isError && <p className="text-sm text-danger">{errorMessage(createGroup.error, 'Could not create group.')}</p>}
      </form>

      <form onSubmit={handleCreateProperty} className="flex flex-col gap-2 border-b border-border pb-4">
        <h3 className="text-sm font-semibold text-text-primary">New config property</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select
            value={propGroupId}
            onChange={(e) => setPropGroupId(e.target.value)}
            aria-label="Group"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          >
            <option value="">Select a group…</option>
            {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <input
            type="text"
            value={propertyKey}
            onChange={(e) => setPropertyKey(e.target.value)}
            placeholder="property_key (e.g. max_portfolios_allowed)"
            aria-label="property_key"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          />
          <input
            type="text"
            value={propName}
            onChange={(e) => setPropName(e.target.value)}
            placeholder="Name"
            aria-label="Property name"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          />
          <select
            value={valueType}
            onChange={(e) => setValueType(e.target.value as ConfigValueType)}
            aria-label="Value type"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          >
            {VALUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <input
          type="text"
          value={propDescription}
          onChange={(e) => setPropDescription(e.target.value)}
          placeholder="Description (which file/service reads this, optional)"
          aria-label="Property description"
          className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
        />
        {valueType === 'integer' && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              type="text"
              value={minValue}
              onChange={(e) => setMinValue(e.target.value)}
              placeholder="Min value (optional)"
              aria-label="Min value"
              className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
            />
            <input
              type="text"
              value={maxValue}
              onChange={(e) => setMaxValue(e.target.value)}
              placeholder="Max value (optional)"
              aria-label="Max value"
              className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={initialValue}
            onChange={(e) => setInitialValue(e.target.value)}
            placeholder="Initial value"
            aria-label="Initial value"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          />
          <button
            type="submit"
            disabled={createProperty.isPending || !propGroupId || !propertyKey.trim() || !propName.trim() || !initialValue.trim()}
            className="ml-auto rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60"
          >
            Create property
          </button>
        </div>
        {createProperty.isError && <p className="text-sm text-danger">{errorMessage(createProperty.error, 'Could not create property.')}</p>}
      </form>

      <div className="flex flex-col gap-2">
        {(groupsLoading || propertiesLoading) && <p className="text-sm text-text-secondary">Loading…</p>}
        {!propertiesLoading && properties?.length === 0 && <p className="text-sm text-text-secondary">No config properties have been created yet.</p>}
        {properties?.map((p) => (
          <PropertyRow key={p.id} property={p} expanded={expandedId === p.id} onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)} />
        ))}
      </div>
    </div>
  );
}

function PropertyRow({ property, expanded, onToggle }: { property: ConfigProperty; expanded: boolean; onToggle: () => void }) {
  const updateMetadata = useUpdateConfigProperty();
  const setValue = useSetConfigPropertyValue();
  const { data: history, isLoading: historyLoading } = useConfigPropertyValueHistory(expanded ? property.id : null);

  const [name, setName] = useState(property.name);
  const [description, setDescription] = useState(property.description ?? '');
  const [minValue, setMinValue] = useState(property.minValue ?? '');
  const [maxValue, setMaxValue] = useState(property.maxValue ?? '');
  const [status, setStatus] = useState(property.status);
  const [newValue, setNewValue] = useState('');
  const [metadataError, setMetadataError] = useState(false);
  const [valueError, setValueError] = useState(false);

  async function handleSaveMetadata(e: FormEvent) {
    e.preventDefault();
    setMetadataError(false);
    try {
      await updateMetadata.mutateAsync({
        id: property.id,
        name: name.trim(),
        description: description.trim() || null,
        minValue: property.valueType === 'integer' && minValue.trim() ? minValue.trim() : null,
        maxValue: property.valueType === 'integer' && maxValue.trim() ? maxValue.trim() : null,
        status,
      });
    } catch {
      setMetadataError(true);
    }
  }

  async function handleSetValue(e: FormEvent) {
    e.preventDefault();
    if (!newValue.trim()) return;
    setValueError(false);
    try {
      await setValue.mutateAsync({ id: property.id, value: newValue.trim() });
      setNewValue('');
    } catch {
      setValueError(true);
    }
  }

  return (
    <div className="rounded-card bg-bg-card p-3 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onToggle}
          data-testid={`property-row-${property.id}`}
          className="text-left hover:underline"
        >
          <p className="font-medium text-text-primary">{property.name}</p>
          <p className="text-sm text-text-secondary">
            {property.groupName} · {property.propertyKey} · {property.valueType}
          </p>
        </button>
        <div className="text-right">
          <p className="font-medium text-text-primary">{property.currentValue}</p>
          <p className="text-xs text-text-muted">version {property.currentVersion} · {property.status}</p>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-4 border-t border-border pt-3">
          <form onSubmit={handleSaveMetadata} className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold text-text-primary">Metadata</h4>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={`Name for ${property.propertyKey}`}
              className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              aria-label={`Description for ${property.propertyKey}`}
              className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
            />
            {property.valueType === 'integer' && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                  placeholder="Min value"
                  aria-label={`Min value for ${property.propertyKey}`}
                  className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
                />
                <input
                  type="text"
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                  placeholder="Max value"
                  aria-label={`Max value for ${property.propertyKey}`}
                  className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label={`Status for ${property.propertyKey}`}
                className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                type="submit"
                disabled={updateMetadata.isPending || !name.trim()}
                className="ml-auto rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60"
              >
                Save metadata
              </button>
            </div>
            {metadataError && <p className="text-sm text-danger">{errorMessage(updateMetadata.error, 'Could not update metadata.')}</p>}
          </form>

          <form onSubmit={handleSetValue} className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold text-text-primary">Set new value</h4>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={`Current: ${property.currentValue}`}
                aria-label={`New value for ${property.propertyKey}`}
                className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
              />
              <button
                type="submit"
                disabled={setValue.isPending || !newValue.trim()}
                className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60"
              >
                Save value
              </button>
            </div>
            {valueError && <p className="text-sm text-danger">{errorMessage(setValue.error, 'Could not save this value.')}</p>}
          </form>

          <div>
            <h4 className="mb-1 text-sm font-semibold text-text-primary">Value history</h4>
            {historyLoading && <p className="text-sm text-text-secondary">Loading…</p>}
            {history && history.length > 0 && (
              <div className="overflow-x-auto rounded-card border border-border">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-text-secondary">
                      <th className="px-2 py-1">Version</th>
                      <th className="px-2 py-1">Value</th>
                      <th className="px-2 py-1">Active</th>
                      <th className="px-2 py-1">Changed by</th>
                      <th className="px-2 py-1">Created at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-b border-border last:border-0">
                        <td className="px-2 py-1">{h.version}</td>
                        <td className="px-2 py-1">{h.value}</td>
                        <td className="px-2 py-1">{h.isActive ? 'Yes' : 'No'}</td>
                        <td className="px-2 py-1">{h.changedByEmail ?? '—'}</td>
                        <td className="px-2 py-1">{h.createdAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
