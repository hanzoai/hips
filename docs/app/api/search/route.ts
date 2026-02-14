import { NextRequest, NextResponse } from 'next/server';
import { source } from '@/lib/source';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query') || '';

  if (!query || query.length < 2) {
    return NextResponse.json([]);
  }

  const results = source.search(query);

  const formattedResults = results.slice(0, 10).map((page) => ({
    id: page.slug.join('/'),
    url: `/docs/${page.slug.join('/')}`,
    title: page.data.title,
    description: page.data.description,
    hip: page.data.frontmatter.hip,
    status: page.data.frontmatter.status,
  }));

  return NextResponse.json(formattedResults);
}
