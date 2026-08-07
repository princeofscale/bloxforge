import type { ToolDefinition } from '../definitions.js';

export const MUTATION_TOOL_DEFINITIONS: ToolDefinition[] = [
  // === Property Write ===
  {
    name: 'set_property',
    category: 'write',
    effects: ['studio.write'],
    description: 'Set a property on an instance — position, size, color, material, transparency, anchored, and the rest',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        },
        propertyName: {
          type: 'string',
          description: 'Property name'
        },
        propertyValue: {
          type: ['string', 'number', 'boolean', 'object', 'array'],
          description: 'Value to set. String, number or boolean for simple properties; for Vector3 use {x,y,z} or [x,y,z], for Color3 {r,g,b} or [r,g,b] (0-255 and 0-1 are both accepted), for UDim2 {x:{scale,offset},y:{scale,offset}} or [xScale,xOffset,yScale,yOffset]. Key casing does not matter. An Enum takes its member name as a string.'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['instancePath', 'propertyName', 'propertyValue']
    }
  },
  {
    name: 'mass_set_property',
    category: 'write',
    effects: ['studio.write'],
    description: 'Set a property on multiple instances at once — color, material, anchored, and the rest',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Instance paths'
        },
        propertyName: {
          type: 'string',
          description: 'Property name'
        },
        propertyValue: {
          type: ['string', 'number', 'boolean', 'object', 'array'],
          description: 'Value to set. String, number or boolean for simple properties; for Vector3 use {x,y,z} or [x,y,z], for Color3 {r,g,b} or [r,g,b] (0-255 and 0-1 are both accepted), for UDim2 {x:{scale,offset},y:{scale,offset}} or [xScale,xOffset,yScale,yOffset]. Key casing does not matter. An Enum takes its member name as a string.'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['paths', 'propertyName', 'propertyValue']
    }
  },
  {
    name: 'mass_get_property',
    category: 'read',
    effects: ['studio.read'],
    description: 'Get a property from multiple instances. Primitives come back as themselves; everything else is tagged — {R,G,B,_type:"Color3"}, {X,Y,Z,_type:"Vector3"}, {Name,Value,EnumType,_type:"EnumItem"} — so reading Color, Material or Size returns a value instead of nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Instance paths'
        },
        propertyName: {
          type: 'string',
          description: 'Property name'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['paths', 'propertyName']
    }
  },
  {
    name: 'set_properties',
    category: 'write',
    effects: ['studio.write'],
    description: 'Set multiple properties on a single instance in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path'
        },
        properties: {
          type: 'object',
          description: 'Map of property name to value'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['instancePath', 'properties']
    }
  },

  // === Object Creation/Deletion ===
  {
    name: 'create_object',
    category: 'write',
    effects: ['studio.write'],
    description: 'Create a new instance — a part, model, folder, GUI object, or any other class. Optionally set properties on creation.',
    inputSchema: {
      type: 'object',
      properties: {
        className: {
          type: 'string',
          description: 'Roblox class name'
        },
        parent: {
          type: 'string',
          description: 'Parent instance path'
        },
        name: {
          type: 'string',
          description: 'Optional name'
        },
        properties: {
          type: 'object',
          description: 'Properties to set on creation. Same value forms as set_property: {x,y,z} or [x,y,z] for Vector3, {r,g,b} or [r,g,b] for Color3 (0-255 and 0-1 both accepted). Any property the engine rejects comes back in propertyErrors — the instance is still created.'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['className', 'parent']
    }
  },
  {
    name: 'mass_create_objects',
    category: 'write',
    effects: ['studio.write'],
    description: 'Create multiple instances at once — parts, models, folders. Each can have optional properties.',
    inputSchema: {
      type: 'object',
      properties: {
        objects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              className: {
                type: 'string',
                description: 'Roblox class name'
              },
              parent: {
                type: 'string',
                description: 'Parent instance path'
              },
              name: {
                type: 'string',
                description: 'Optional name'
              },
              properties: {
                type: 'object',
                description: 'Properties to set on creation. Same value forms as set_property: {x,y,z} or [x,y,z] for Vector3, {r,g,b} or [r,g,b] for Color3 (0-255 and 0-1 both accepted). Any property the engine rejects comes back in propertyErrors — the instance is still created.'
              }
            },
            required: ['className', 'parent']
          },
          description: 'Objects to create'
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview the bulk creation without creating anything (default false).'
        },
        confirm: {
          type: 'boolean',
          description: 'Approve a large bulk creation the safety layer would otherwise gate (default false).'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['objects']
    }
  },
  {
    name: 'delete_object',
    category: 'write',
    effects: ['studio.write'],
    description: 'Delete an instance — a part, model, or any other object. Deleting a protected service/root (e.g. Workspace, ServerScriptService) requires confirm:true. Use dryRun:true to preview.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview the deletion without removing anything (default false).'
        },
        confirm: {
          type: 'boolean',
          description: 'Approve a deletion the safety layer would otherwise gate, such as a protected service/root (default false).'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['instancePath']
    }
  },
  {
    name: 'mass_delete_objects',
    category: 'write',
    effects: ['studio.write'],
    description: 'Delete many instances in one round-trip, the bulk counterpart to mass_create_objects. The whole batch is one Studio undo step, so a single Ctrl+Z (or the undo tool) puts everything back. Missing paths are reported per-path rather than failing the batch. Large batches and any protected service/root in the list require confirm:true; use dryRun:true to preview.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Instance paths to delete (dot notation).'
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview the deletion without removing anything (default false).'
        },
        confirm: {
          type: 'boolean',
          description: 'Approve a deletion the safety layer would otherwise gate — a large batch, or a protected service/root in the list (default false).'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['paths']
    }
  },

  // === Duplication ===
  {
    name: 'smart_duplicate',
    category: 'write',
    effects: ['studio.write'],
    description: 'Duplicate with naming, positioning, and property variations',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        },
        count: {
          type: 'number',
          description: 'Number of duplicates'
        },
        options: {
          type: 'object',
          properties: {
            namePattern: {
              type: 'string',
              description: 'Name pattern ({n} placeholder)'
            },
            positionOffset: {
              type: 'array',
              items: { type: 'number' },
              description: 'X, Y, Z offset per duplicate'
            },
            rotationOffset: {
              type: 'array',
              items: { type: 'number' },
              description: 'X, Y, Z rotation offset'
            },
            scaleOffset: {
              type: 'array',
              items: { type: 'number' },
              description: 'X, Y, Z scale multiplier'
            },
            propertyVariations: {
              type: 'object',
              description: 'Property name to array of values'
            },
            targetParents: {
              type: 'array',
              items: { type: 'string' },
              description: 'Different parent per duplicate'
            }
          }
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['instancePath', 'count']
    }
  },
  {
    name: 'mass_duplicate',
    category: 'write',
    effects: ['studio.write'],
    description: 'Batch smart_duplicate operations',
    inputSchema: {
      type: 'object',
      properties: {
        duplications: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              instancePath: {
                type: 'string',
                description: 'Instance path (dot notation)'
              },
              count: {
                type: 'number',
                description: 'Number of duplicates'
              },
              options: {
                type: 'object',
                properties: {
                  namePattern: {
                    type: 'string',
                    description: 'Name pattern ({n} placeholder)'
                  },
                  positionOffset: {
                    type: 'array',
                    items: { type: 'number' },
                    description: 'X, Y, Z offset per duplicate'
                  },
                  rotationOffset: {
                    type: 'array',
                    items: { type: 'number' },
                    description: 'X, Y, Z rotation offset'
                  },
                  scaleOffset: {
                    type: 'array',
                    items: { type: 'number' },
                    description: 'X, Y, Z scale multiplier'
                  },
                  propertyVariations: {
                    type: 'object',
                    description: 'Property name to array of values'
                  },
                  targetParents: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Different parent per duplicate'
                  }
                }
              }
            },
            required: ['instancePath', 'count']
          },
          description: 'Duplication operations'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['duplications']
    }
  },

  {
    name: 'apply_mutation_plan',
    category: 'write',
    effects: ['studio.execute'],
    description: 'Apply many small edits in ONE round-trip as a transaction: set_property (primitive values), set_attribute, add_tag, remove_tag. Returns a per-op result with before/after, and a ready-to-run `rollback` plan (a reverse mutation plan you can pass straight back to undo). Use dryRun:true to preview the diff without changing anything; large plans require confirm:true. For Vector3/Color3/Enum property values use set_property instead (full type deserialization).',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'Ordered list of operations.',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['set_property', 'set_attribute', 'add_tag', 'remove_tag'] },
              target: { type: 'string', description: 'Instance path, e.g. game.Workspace.Part' },
              property: { type: 'string', description: 'For set_property.' },
              name: { type: 'string', description: 'For set_attribute.' },
              tag: { type: 'string', description: 'For add_tag / remove_tag.' },
              value: { type: ['boolean', 'number', 'string'], description: 'For set_property / set_attribute (primitive).' },
              expected: { type: ['boolean', 'number', 'string', 'null'], description: 'Optional optimistic-lock value. The whole plan is rejected before writes when the current value differs.' }
            },
            required: ['op', 'target']
          }
        },
        dryRun: { type: 'boolean', description: 'Preview the diff without applying (default false).' },
        atomic: { type: 'boolean', description: 'Rollback earlier successful operations when a later operation fails (default true).' },
        confirm: { type: 'boolean', description: 'Approve a large plan the safety layer gates.' },
        instance_id: { type: 'string', description: 'Connected Studio place id. Required only when multiple places are open.' }
      },
      required: ['operations']
    }
  },

  // === Calculated/Relative Properties ===
];
