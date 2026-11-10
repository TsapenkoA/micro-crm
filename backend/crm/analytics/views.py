from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from crm.analytics.serializers import DashboardFilters
from crm.api.permissions import IsWorkspaceMember
from crm.analytics.services import dashboard_data


class Dashboard(APIView):
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get(self, request):
        filters = DashboardFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        return Response(dashboard_data(request.workspace_id, filters.validated_data["currency"], filters.validated_data["period"]))
