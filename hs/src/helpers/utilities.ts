import { z, ZodObject, ZodRawShape } from "zod";
import _ from "lodash";
const crypto = require('crypto');
import { fetch as localFetch } from '../index';
import { Env } from '../types';
import { Context } from "hono";

const inferObjectShape = (obj: Record<string, unknown>): ZodObject<ZodRawShape> => {
  const shape: ZodRawShape = {};

  for (const key in obj) {
    const value = obj[key];
    if (typeof value === "string") {
      shape[key] = z.string();
    } else if (typeof value === "number") {
      shape[key] = z.number();
    } else if (typeof value === "boolean") {
      shape[key] = z.boolean();
    } else if (Array.isArray(value)) {
      shape[key] = z.array(z.any());
    } else if (typeof value === "object" && value !== null) {
      shape[key] = z.record(z.any());
    } else {
      shape[key] = z.any();
    }
  }

  return z.object(shape);
}

export const validateArrayOfObjectsWithSameStructure = (data: unknown) => {
  if (!Array.isArray(data) || data.length === 0 || typeof data[0] !== "object") {
    return false;
  }

  const baseSchema = inferObjectShape(data[0] as Record<string, unknown>);
  const arraySchema = z.array(baseSchema);

  const result = arraySchema.safeParse(data);
  return result.success;
}

export const validateJson = (jsonString: string) => {
    try {
        const jsonStringObj = JSON.parse(jsonString);
        return true; 
    } catch (error) {
        return false;
    }
}

export const getValueOrFalse = (obj: object, key: string) => {
  if (_.has(obj, key)) {
    const value = _.get(obj, key);
    return value !== null && value !== '' ? value : '';
  }
  return '';
}

export const objectIsEmpty = (obj: object) => {
  if ( _.isEmpty(obj) ) return true;
  return false;
}

export const getValFromKV = async (kv: KVNamespace, key:string) => {
  return await kv.get(key);
}

export const decrypt = (toBeDecrypted: string, encKey: string, encIV: string) => {
  const algorithm = 'aes-256-cbc'; // Example algorithm
  const encryptedBase64 = toBeDecrypted;
  const encryptionKeyHex = encKey;
  const ivHex = encIV;
  
  const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
  const key = Buffer.from(encryptionKeyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedBuffer, null, 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

export const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch (err) {
    return false;
  }
}

export const isValidDate = (value: string) => {
  const date = new Date(value);
  return !isNaN(date.getTime());
}

export const formatDate = (value: string) => {
  const date = new Date(value);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).replace(',', '');
}

const getDeepValue = (obj: any, path: any, fallback = '') => {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current && typeof current === 'object') {
      // Support for numeric index access in arrays
      if (Array.isArray(current) && !isNaN(part)) {
        current = current[Number(part)];
      } else if (part in current) {
        current = current[part];
      } else {
        return fallback;
      }
    } else {
      return fallback;
    }
  }

  return current ?? fallback;
}

const interpolateString = (str: string, values: any) => {
  return str.replace(/{{([\w.]+)(?::([^}]*))?}}/g, (_, keyPath, defaultValue) => {
    return getDeepValue(values, keyPath, defaultValue ?? '');
  });
}

export const interpolateObject = (template: any, values: any) => {
  // placeholders in template should be in the form {{path.to.value.in.values:fallback_value}}
  // or {{path.to.array.position_in_array.array_element_key:fallback_value}} (i.e. {{users.0.age:unknown}})
  // no spaces are allowed in placeholders, like {{ users.0.name }}
  if (typeof template === 'string') {
    return interpolateString(template, values);
  } else if (Array.isArray(template)) {
    return template.map(item => interpolateObject(item, values));
  } else if (typeof template === 'object' && template !== null) {
    return Object.fromEntries(
      Object.entries(template).map(([k, v]) => [k, interpolateObject(v, values)])
    );
  }
  return template;
}

export const flattenObject = (obj: any, prefix = '', res = {}) => {
  _.forOwn(obj, (value, key) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (_.isArray(value)) {
      value.forEach((item, index) => {
        if (_.isPlainObject(item)) {
          flattenObject(item, `${fullKey}[${index}]`, res);
        } else {
          res[`${fullKey}[${index}]`] = item;
        }
      });
    } else if (_.isPlainObject(value)) {
      flattenObject(value, fullKey, res);
    } else {
      res[fullKey] = value;
    }
  });

  return res;
}

export const validateRequest = async (c: any) => {
  const authHeader = c.req.raw.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response('Unauthorized, missing header', { status: 401 });
  }

  const authToken = authHeader.slice(7); // Remove 'Bearer ' prefix

  if (c.env.API_TOKEN !== authToken) {
    return new Response('Unauthorized', { status: 403 });
  }

  return new Response('Authorized access!', { status: 200 });
}

export const sendRequest = async (
  url: string,
  authToken: string,
  method: string,
  body: any = null
) => {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : null,
  });

  const text = await response.text();

  if (!response.ok) {
    console.error("Status:", response.status);
    console.error("Body:", text);
    throw new Error(`Request failed with status ${response.status}`);
  }

  return text;
};

export const getCurrentFunctionName = (): string | undefined => {
  const stack = new Error().stack;

  if (!stack) return undefined;

  const stackLines = stack.split("\n");

  // stackLines[0] is "Error"
  // stackLines[1] is the current function
  // stackLines[2] is the caller of getCurrentFunctionName (i.e., the function you're in)

  const currentLine = stackLines[2]; // <-- 3rd line is the function we're in
  const match = currentLine.match(/at\s+(.*?)\s+\(/);

  return match ? match[1] : undefined;
}

export const sendIternalRequest = async (
  url: string,
  method: string,
  body: any = null,
  env: Env, 
  ctx: ExecutionContext
) => {

  const createInternalRequest = (url: string, method: string, body: any = null) => {
    // Base request options
    const requestOptions: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${env.API_TOKEN}`,
        "Content-Type": "application/json",
      },
    };
  
    // Only include the body if it's not a GET or HEAD method
    if (method !== 'GET' && method !== 'HEAD' && body) {
      requestOptions.body = JSON.stringify(body);
    }
  
    // Return the new Request object
    return new Request(url, requestOptions);
  };
  
  const internalResponse = await localFetch(createInternalRequest(url, method, body), env, ctx);
  const result = await internalResponse.text();
  return result;
};

export const createMockContext = (env: Env, ctx: ExecutionContext): Context => {
  const req = new Request("https://cron.mock/trigger", {
    method: "GET",
  });

  const mockExecutionCtx = ctx;

  // Return a simple mock Context
  const c = {
    req,
    env,
    executionCtx: mockExecutionCtx,
    get: (key: string) => undefined,
    set: (_key: string, _value: any) => {},
    text: (body: string, status = 200) =>
      new Response(body, { status, headers: { "Content-Type": "text/plain" } }),
    json: (obj: unknown, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  } as unknown as Context;

  return c;
}

export const encodeLinkJsonQueryParams = (rawUrl: string) => {
  const url = new URL(rawUrl);

  for (const [key, value] of url.searchParams.entries()) {
    try {
      // Try parsing the value as JSON
      const parsed = JSON.parse(value);
      // If successful, re-encode as a URI component
      const encoded = encodeURIComponent(JSON.stringify(parsed));
      url.searchParams.set(key, encoded);
    } catch {
      // Ignore if not JSON
    }
  }

  return url.toString();
}

export const getTimestamp14DaysAgoMillis = (interval: number) => {
  const now = Date.now(); // current time in milliseconds
  const fourteenDaysInMillis = interval * 24 * 60 * 60 * 1000;
  return now - fourteenDaysInMillis;
}

export function formatDateToString(date: Date) {
  const day = String(date.getDate()).padStart(2, '0');
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();

  return `${day}-${month}-${year}`;
}