import { Request, Response, NextFunction } from 'express';
import * as configPropertyService from '../services/configProperty.service';

function getIdParam(req: Request): string {
  const raw = req.params.id;
  return (Array.isArray(raw) ? raw[0] : raw || '').trim();
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// GET /config-properties/groups
export async function listGroups(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const groups = await configPropertyService.listGroups();
    res.json({ groups });
  } catch (err) {
    next(err);
  }
}

export async function createGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
  const name = nonEmptyString(req.body?.name);
  if (!name) {
    res.status(400).json({ error: 'A name is required.' });
    return;
  }
  try {
    const group = await configPropertyService.createGroup({ name, description: nonEmptyString(req.body?.description) });
    res.status(201).json({ group });
  } catch (err) {
    if (err instanceof configPropertyService.DuplicateConfigGroupError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function updateGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
  const name = nonEmptyString(req.body?.name);
  if (!name) {
    res.status(400).json({ error: 'A name is required.' });
    return;
  }
  try {
    const group = await configPropertyService.updateGroup(getIdParam(req), { name, description: nonEmptyString(req.body?.description) });
    if (!group) {
      res.status(404).json({ error: 'Config group not found.' });
      return;
    }
    res.json({ group });
  } catch (err) {
    if (err instanceof configPropertyService.DuplicateConfigGroupError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// GET /config-properties/properties[?groupId=]
export async function listProperties(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const groupId = typeof req.query.groupId === 'string' && req.query.groupId.trim() ? req.query.groupId.trim() : undefined;
    const properties = await configPropertyService.listProperties({ groupId });
    res.json({ properties });
  } catch (err) {
    next(err);
  }
}

export async function createProperty(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { groupId, propertyKey, name, valueType, initialValue } = req.body || {};
  if (typeof groupId !== 'string' || !groupId.trim()) {
    res.status(400).json({ error: 'A groupId is required.' });
    return;
  }
  if (typeof propertyKey !== 'string' || !propertyKey.trim()) {
    res.status(400).json({ error: 'A propertyKey is required.' });
    return;
  }
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'A name is required.' });
    return;
  }
  if (typeof valueType !== 'string' || !valueType.trim()) {
    res.status(400).json({ error: 'A valueType is required.' });
    return;
  }
  if (typeof initialValue !== 'string' || !initialValue.trim()) {
    res.status(400).json({ error: 'An initialValue is required.' });
    return;
  }
  try {
    const property = await configPropertyService.createProperty({
      groupId: groupId.trim(),
      propertyKey: propertyKey.trim(),
      name: name.trim(),
      description: nonEmptyString(req.body?.description),
      valueType: valueType.trim(),
      minValue: nonEmptyString(req.body?.minValue),
      maxValue: nonEmptyString(req.body?.maxValue),
      status: nonEmptyString(req.body?.status) ?? 'active',
      initialValue: initialValue.trim(),
      changedBy: req.user!.id,
    });
    res.status(201).json({ property });
  } catch (err) {
    if (err instanceof configPropertyService.InvalidValueTypeError || err instanceof configPropertyService.InvalidConfigValueError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof configPropertyService.DuplicatePropertyKeyError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function updateProperty(req: Request, res: Response, next: NextFunction): Promise<void> {
  const name = nonEmptyString(req.body?.name);
  if (!name) {
    res.status(400).json({ error: 'A name is required.' });
    return;
  }
  const status = nonEmptyString(req.body?.status) ?? 'active';
  try {
    const property = await configPropertyService.updatePropertyMetadata(getIdParam(req), {
      name,
      description: nonEmptyString(req.body?.description),
      minValue: nonEmptyString(req.body?.minValue),
      maxValue: nonEmptyString(req.body?.maxValue),
      status,
    });
    if (!property) {
      res.status(404).json({ error: 'Config property not found.' });
      return;
    }
    res.json({ property });
  } catch (err) {
    next(err);
  }
}

export async function setValue(req: Request, res: Response, next: NextFunction): Promise<void> {
  const value = typeof req.body?.value === 'string' ? req.body.value : null;
  if (value === null || !value.trim()) {
    res.status(400).json({ error: 'A value is required.' });
    return;
  }
  try {
    const propertyValue = await configPropertyService.setPropertyValue(getIdParam(req), { value: value.trim(), changedBy: req.user!.id });
    if (!propertyValue) {
      res.status(404).json({ error: 'Config property not found.' });
      return;
    }
    res.json({ value: propertyValue });
  } catch (err) {
    if (err instanceof configPropertyService.InvalidConfigValueError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function listValueHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const history = await configPropertyService.listPropertyValueHistory(getIdParam(req));
    res.json({ history });
  } catch (err) {
    next(err);
  }
}
