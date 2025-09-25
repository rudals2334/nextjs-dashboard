'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import postgres from 'postgres';
import { signIn } from '@/auth';
import { AuthError } from 'next-auth';

// ---------- 공용: DB 연결 ----------
const conn = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!conn) throw new Error('DATABASE_URL or POSTGRES_URL is not set');
const sql = postgres(conn, { ssl: 'require' });

// ---------- 공용: 타입/스키마 ----------
export type State = {
  errors?: {
    customerId?: string[];
    amount?: string[];
    status?: string[];
  };
  message?: string | null;
};

const FormSchema = z.object({
  id: z.string().optional(), // update는 bind로 받음이므로 optional
  customerId: z.string({ invalid_type_error: 'Please select a customer.' }),
  amount: z.coerce.number().gt(0, { message: 'Please enter an amount greater than $0.' }),
  status: z.enum(['pending', 'paid'], {
    invalid_type_error: 'Please select an invoice status.',
  }),
  date: z.string().optional(),
});

const CreateInvoice = FormSchema.pick({
  customerId: true,
  amount: true,
  status: true,
});

const UpdateInvoice = CreateInvoice; // 동일 필드

// ---------- 서버 액션들 ----------
export async function createInvoice(prevState: State, formData: FormData) {
  // Validate
  const validated = CreateInvoice.safeParse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });

  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Create Invoice.',
    } satisfies State;
  }

  const { customerId, amount, status } = validated.data;
  const amountInCents = Math.round(amount * 100);
  const date = new Date().toISOString().split('T')[0];

  try {
    await sql`
      INSERT INTO invoices (customer_id, amount, status, date)
      VALUES (${customerId}, ${amountInCents}, ${status}, ${date})
    `;
  } catch {
    return { message: 'Database Error: Failed to Create Invoice.' } satisfies State;
  }

  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

export async function updateInvoice(id: string, prevState: State, formData: FormData) {
  const validated = UpdateInvoice.safeParse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });

  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Update Invoice.',
    } satisfies State;
  }

  const { customerId, amount, status } = validated.data;
  const amountInCents = Math.round(amount * 100);

  try {
    await sql`
      UPDATE invoices
      SET customer_id = ${customerId}, amount = ${amountInCents}, status = ${status}
      WHERE id = ${id}
    `;
  } catch {
    return { message: 'Database Error: Failed to Update Invoice.' } satisfies State;
  }

  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

export async function deleteInvoice(id: string) {
  // 필요 시 예외 제거하고 실제 삭제로 바꾸세요
  throw new Error('Failed to Delete Invoice');

  // await sql`DELETE FROM invoices WHERE id = ${id}`;
  // revalidatePath('/dashboard/invoices');
}

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  try {
    await signIn('credentials', formData);
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'Invalid credentials.';
        default:
          return 'Something went wrong.';
      }
    }
    throw error;
  }
}
