import { Card, CardHeader, CardTitle, CardContent } from '../../../core/components/ui/card';

export function CategoriesScreen() {
  return (
    <div className="flex-1 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Categories</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Empty State</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Backend implementation for Categories is pending. No mock data is used.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
