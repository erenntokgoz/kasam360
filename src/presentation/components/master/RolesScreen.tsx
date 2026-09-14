import { Card, CardHeader, CardTitle, CardContent } from '../../../core/components/ui/card';

export function RolesScreen() {
  return (
    <div className="flex-1 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Roles</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Empty State</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Backend implementation for Roles is pending. No mock data is used.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
